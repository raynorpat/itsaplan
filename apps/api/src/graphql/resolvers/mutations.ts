import { db, projectColumn } from '@repo/db';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import {
  archiveIssue,
  createIssue,
  deleteIssue,
  restoreIssue,
  updateIssue,
  type IssuePatch,
} from '../../issues/store';
import { archiveColumn, createColumn, updateColumn } from '../../columns/store';
import { getProjectByKey } from '../../projects/store';
import { assertPermission } from '../../shared/access';
import { deleteObjects } from '../../shared/s3';
import type { GraphQLContext } from '../context';
import { fromHttpError, gqlError } from '../errors';
import { findIssue, issueById, toIssue } from './issue';
import { findTeam } from './team';
import { findState, toWorkflowState } from './workflow-state';

// Issue and workflow state mutations. Each one checks the same permission as the
// matching REST route and calls the same store function, so activity, webhooks,
// notifications and agent runs are identical. Store HttpErrors become GraphQL
// errors (400 INVALID_INPUT, 403 FORBIDDEN, 404 ENTITY_NOT_FOUND, 409 CONFLICT).

// An increasing number for the payload's lastSyncId. This app has no sync log, so
// it is the current time in milliseconds.
const lastSyncId = () => Date.now();

const STATE_TYPES = new Set(['backlog', 'unstarted', 'started', 'completed', 'canceled']);

// Throws INVALID_INPUT naming the first input field outside `supported`.
function onlySupported(input: Record<string, unknown>, supported: string[], what: string): void {
  const extra = Object.keys(input).find((k) => input[k] !== undefined && !supported.includes(k));
  if (extra) throw gqlError('INVALID_INPUT', `${what}.${extra} is not supported`);
}

async function guard<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    return fromHttpError(err);
  }
}

// The IssueUpdateInput / IssueCreateInput fields that map onto the store patch.
const ISSUE_FIELDS = [
  'title',
  'description',
  'priority',
  'estimate',
  'dueDate',
  'assigneeId',
  'delegateId',
  'parentId',
  'stateId',
  'sortOrder',
];

type IssueInput = Record<string, unknown> & {
  title?: string;
  description?: string;
  priority?: number;
  estimate?: number | null;
  dueDate?: string | null;
  assigneeId?: string | null;
  delegateId?: string | null;
  parentId?: string | null;
  stateId?: string;
  sortOrder?: number;
};

function toPatch(input: IssueInput): IssuePatch {
  const patch: IssuePatch = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.description !== undefined) patch.description = input.description ?? '';
  if (input.priority !== undefined) patch.priority = input.priority;
  if (input.estimate !== undefined) patch.estimate = input.estimate;
  if (input.dueDate !== undefined) patch.dueDate = input.dueDate;
  if (input.assigneeId !== undefined) patch.assigneeUserId = input.assigneeId;
  if (input.delegateId !== undefined) patch.delegateUserId = input.delegateId;
  if (input.parentId !== undefined) patch.parentId = input.parentId;
  if (input.stateId !== undefined) patch.columnId = input.stateId;
  if (input.sortOrder !== undefined) patch.position = input.sortOrder;
  return patch;
}

// The column a new issue lands in when no stateId is given: the first active
// backlog column, else the first active unstarted column.
async function defaultColumn(projectId: string): Promise<string> {
  const rows = await db
    .select({ id: projectColumn.id })
    .from(projectColumn)
    .where(
      and(
        eq(projectColumn.projectId, projectId),
        isNull(projectColumn.archivedAt),
        sql`${projectColumn.stateType} IN ('backlog', 'unstarted')`,
      ),
    )
    .orderBy(sql`${projectColumn.stateType} = 'unstarted'`, asc(projectColumn.position))
    .limit(1);
  if (!rows[0]) throw gqlError('INVALID_INPUT', 'The team has no backlog or unstarted state');
  return rows[0].id;
}

export const mutationResolvers = {
  Mutation: {
    issueCreate: async (
      _: unknown,
      { input }: { input: IssueInput & { teamId: string } },
      ctx: GraphQLContext,
    ) =>
      guard(async () => {
        onlySupported(input, ['teamId', ...ISSUE_FIELDS], 'input');
        if (!input.title) throw gqlError('INVALID_INPUT', 'input.title is required');
        const team = await findTeam(input.teamId, ctx.user.id);
        await assertPermission(team.id, ctx.user, 'work_items', 'create');
        const project = (await getProjectByKey(team.key))!;
        const patch = toPatch(input);
        const created = await createIssue(
          project,
          {
            columnId: patch.columnId ?? (await defaultColumn(team.id)),
            title: input.title,
            description: patch.description,
            priority: patch.priority,
            estimate: patch.estimate,
            dueDate: patch.dueDate,
            assigneeUserId: patch.assigneeUserId,
            delegateUserId: patch.delegateUserId,
            parentId: patch.parentId,
            position: patch.position,
          },
          ctx.user.id,
        );
        return { success: true, lastSyncId: lastSyncId(), issue: await issueById(created.id) };
      }),

    issueUpdate: async (
      _: unknown,
      { id, input }: { id: string; input: IssueInput },
      ctx: GraphQLContext,
    ) =>
      guard(async () => {
        onlySupported(input, ISSUE_FIELDS, 'input');
        const row = await findIssue(id, ctx.user.id);
        await assertPermission(row.projectId, ctx.user, 'work_items', 'edit');
        await updateIssue(row.id, toPatch(input), ctx.user.id);
        return { success: true, lastSyncId: lastSyncId(), issue: await issueById(row.id) };
      }),

    // Linear runs the batch in one transaction. Here every issue is resolved and
    // permission-checked before the first write, so an invisible or forbidden id
    // fails the call with nothing changed; the writes themselves are per issue.
    issueBatchUpdate: async (
      _: unknown,
      { ids, input }: { ids: string[]; input: IssueInput },
      ctx: GraphQLContext,
    ) =>
      guard(async () => {
        onlySupported(input, ISSUE_FIELDS, 'input');
        if (ids.length < 1 || ids.length > 50)
          throw gqlError('INVALID_INPUT', 'ids must hold between 1 and 50 issues');
        const rows = [];
        for (const id of ids) {
          const row = await findIssue(id, ctx.user.id);
          await assertPermission(row.projectId, ctx.user, 'work_items', 'edit');
          rows.push(row);
        }
        const patch = toPatch(input);
        for (const row of rows) await updateIssue(row.id, patch, ctx.user.id);
        const issues = [];
        for (const row of rows) issues.push(await issueById(row.id));
        return { success: true, lastSyncId: lastSyncId(), issues };
      }),

    issueArchive: async (_: unknown, { id }: { id: string }, ctx: GraphQLContext) =>
      guard(async () => {
        const row = await findIssue(id, ctx.user.id);
        await assertPermission(row.projectId, ctx.user, 'work_items', 'edit');
        await archiveIssue(row.id, ctx.user.id);
        return { success: true, lastSyncId: lastSyncId(), entity: await issueById(row.id) };
      }),

    issueUnarchive: async (_: unknown, { id }: { id: string }, ctx: GraphQLContext) =>
      guard(async () => {
        const row = await findIssue(id, ctx.user.id);
        await assertPermission(row.projectId, ctx.user, 'work_items', 'edit');
        await restoreIssue(row.id, ctx.user.id);
        return { success: true, lastSyncId: lastSyncId(), entity: await issueById(row.id) };
      }),

    // There is no trash: delete removes the issue, as REST does, and purges its
    // attachment objects best-effort.
    issueDelete: async (_: unknown, { id }: { id: string }, ctx: GraphQLContext) =>
      guard(async () => {
        const row = await findIssue(id, ctx.user.id);
        await assertPermission(row.projectId, ctx.user, 'work_items', 'delete');
        const entity = toIssue(row);
        const attachments = await deleteIssue(row.id);
        if (attachments?.length) await deleteObjects(attachments.map((a) => a.s3Key));
        return { success: true, lastSyncId: lastSyncId(), entity };
      }),

    workflowStateCreate: async (
      _: unknown,
      {
        input,
      }: {
        input: Record<string, unknown> & {
          teamId: string;
          name: string;
          type: string;
          color: string;
          description?: string;
        };
      },
      ctx: GraphQLContext,
    ) =>
      guard(async () => {
        onlySupported(input, ['teamId', 'name', 'type', 'color', 'description'], 'input');
        if (!STATE_TYPES.has(input.type))
          throw gqlError('INVALID_INPUT', `input.type ${input.type} is not supported`);
        const team = await findTeam(input.teamId, ctx.user.id);
        await assertPermission(team.id, ctx.user, 'states', 'create');
        const column = await createColumn({
          projectId: team.id,
          name: input.name,
          stateType: input.type,
          color: input.color,
          description: input.description,
        });
        return {
          success: true,
          lastSyncId: lastSyncId(),
          workflowState: await stateById(column.id),
        };
      }),

    workflowStateUpdate: async (
      _: unknown,
      {
        id,
        input,
      }: {
        id: string;
        input: Record<string, unknown> & { name?: string; color?: string; description?: string };
      },
      ctx: GraphQLContext,
    ) =>
      guard(async () => {
        onlySupported(input, ['name', 'color', 'description'], 'input');
        const state = await findState(id, ctx.user.id);
        await assertPermission(state.projectId, ctx.user, 'states', 'edit');
        await updateColumn(state.id, state.projectId, {
          name: input.name ?? undefined,
          color: input.color ?? undefined,
          description: input.description ?? undefined,
        });
        return {
          success: true,
          lastSyncId: lastSyncId(),
          workflowState: await stateById(state.id),
        };
      }),

    workflowStateArchive: async (_: unknown, { id }: { id: string }, ctx: GraphQLContext) =>
      guard(async () => {
        const state = await findState(id, ctx.user.id);
        await assertPermission(state.projectId, ctx.user, 'states', 'edit');
        await archiveColumn(state.id, state.projectId);
        return { success: true, lastSyncId: lastSyncId(), entity: await stateById(state.id) };
      }),
  },
};

async function stateById(id: string) {
  const [row] = await db.select().from(projectColumn).where(eq(projectColumn.id, id));
  return toWorkflowState(row!);
}
