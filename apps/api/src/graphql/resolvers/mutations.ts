import { db, issueLabel, workflowState } from '@repo/db';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import {
  archiveIssue,
  createIssue,
  deleteIssue,
  restoreIssue,
  updateIssue,
  validateIssuePatch,
  type IssuePatch,
} from '../../issues/store';
import { archiveState, createState, updateState } from '../../states/store';
import { getTeamByKey } from '../../teams/store';
import { assertPermission } from '../../shared/access';
import { UUID_RE } from '../../shared/lib';
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
export const lastSyncId = () => Date.now();

const STATE_TYPES = new Set(['backlog', 'unstarted', 'started', 'completed', 'canceled']);

// Throws INVALID_INPUT naming the first input field outside `supported`.
export function onlySupported(
  input: Record<string, unknown>,
  supported: string[],
  what: string,
): void {
  const extra = Object.keys(input).find((k) => input[k] !== undefined && !supported.includes(k));
  if (extra) throw gqlError('INVALID_INPUT', `${what}.${extra} is not supported`);
}

export async function guard<T>(run: () => Promise<T>): Promise<T> {
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
  'projectId',
  'projectMilestoneId',
];

// Label inputs of issueUpdate: a full replacement, or labels to add / remove.
const LABEL_FIELDS = ['labelIds', 'addedLabelIds', 'removedLabelIds'];

function labelIdsInput(value: unknown, path: string): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string' || !UUID_RE.test(v)))
    throw gqlError('INVALID_INPUT', `${path} must be a list of label ids`);
  return value as string[];
}

// The issue's label set after an update's label inputs, or undefined when none is
// given. labelIds replaces the set; addedLabelIds / removedLabelIds change it.
async function nextLabelIds(issueId: string, input: Record<string, unknown>) {
  const replace = labelIdsInput(input.labelIds, 'input.labelIds');
  const added = labelIdsInput(input.addedLabelIds, 'input.addedLabelIds');
  const removed = labelIdsInput(input.removedLabelIds, 'input.removedLabelIds');
  if (replace) return replace;
  if (!added && !removed) return undefined;
  const rows = await db
    .select({ id: issueLabel.labelId })
    .from(issueLabel)
    .where(eq(issueLabel.issueId, issueId));
  const next = new Set(rows.map((r) => r.id));
  for (const id of added ?? []) next.add(id);
  for (const id of removed ?? []) next.delete(id);
  return [...next];
}

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
  projectId?: string | null;
  projectMilestoneId?: string | null;
};

const ID_FIELDS = [
  'stateId',
  'parentId',
  'assigneeId',
  'delegateId',
  'projectId',
  'projectMilestoneId',
] as const;

// The checks REST does in its route schema: ids are UUIDs, priority is 0..4, a
// title is not empty, dueDate is YYYY-MM-DD. Postgres would reject the rest.
function assertIssueInput(input: IssueInput): void {
  for (const field of ID_FIELDS) {
    const v = input[field];
    if (v != null && !UUID_RE.test(String(v)))
      throw gqlError('INVALID_INPUT', `input.${field} must be a UUID`);
  }
  if (
    input.priority != null &&
    !(Number.isInteger(input.priority) && input.priority >= 0 && input.priority <= 4)
  )
    throw gqlError('INVALID_INPUT', 'input.priority must be an integer from 0 to 4');
  if (input.title !== undefined && !input.title)
    throw gqlError('INVALID_INPUT', 'input.title must not be empty');
  if (input.dueDate != null && !/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate))
    throw gqlError('INVALID_INPUT', 'input.dueDate must be YYYY-MM-DD');
}

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
  if (input.stateId !== undefined) patch.stateId = input.stateId;
  if (input.sortOrder !== undefined) patch.position = input.sortOrder;
  if (input.projectId !== undefined) patch.projectId = input.projectId;
  if (input.projectMilestoneId !== undefined) patch.projectMilestoneId = input.projectMilestoneId;
  return patch;
}

// The column a new issue lands in when no stateId is given: the first active
// backlog column, else the first active unstarted column.
async function defaultColumn(teamId: string): Promise<string> {
  const rows = await db
    .select({ id: workflowState.id })
    .from(workflowState)
    .where(
      and(
        eq(workflowState.teamId, teamId),
        isNull(workflowState.archivedAt),
        sql`${workflowState.stateType} IN ('backlog', 'unstarted')`,
      ),
    )
    .orderBy(sql`${workflowState.stateType} = 'unstarted'`, asc(workflowState.position))
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
        onlySupported(input, ['teamId', 'labelIds', ...ISSUE_FIELDS], 'input');
        if (!input.title) throw gqlError('INVALID_INPUT', 'input.title is required');
        assertIssueInput(input);
        const found = await findTeam(input.teamId, ctx.user.id);
        await assertPermission(found.id, ctx.user, 'work_items', 'create');
        const team = (await getTeamByKey(found.key))!;
        const patch = toPatch(input);
        const created = await createIssue(
          team,
          {
            stateId: patch.stateId ?? (await defaultColumn(team.id)),
            title: input.title,
            description: patch.description,
            priority: patch.priority,
            estimate: patch.estimate,
            dueDate: patch.dueDate,
            assigneeUserId: patch.assigneeUserId,
            delegateUserId: patch.delegateUserId,
            parentId: patch.parentId,
            projectId: patch.projectId,
            projectMilestoneId: patch.projectMilestoneId,
            position: patch.position,
            labelIds: labelIdsInput(input.labelIds, 'input.labelIds'),
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
        onlySupported(input, [...ISSUE_FIELDS, ...LABEL_FIELDS], 'input');
        assertIssueInput(input);
        const row = await findIssue(id, ctx.user.id);
        await assertPermission(row.teamId, ctx.user, 'work_items', 'edit');
        const labelIds = await nextLabelIds(row.id, input);
        await updateIssue(row.id, toPatch(input), ctx.user.id, { labelIds });
        return { success: true, lastSyncId: lastSyncId(), issue: await issueById(row.id) };
      }),

    // Linear runs the batch in one transaction. Here every issue is resolved,
    // permission-checked and validated against the patch before the first write,
    // so an invalid id or input fails the call with nothing changed; the writes
    // themselves are per issue.
    issueBatchUpdate: async (
      _: unknown,
      { ids, input }: { ids: string[]; input: IssueInput },
      ctx: GraphQLContext,
    ) =>
      guard(async () => {
        onlySupported(input, ISSUE_FIELDS, 'input');
        assertIssueInput(input);
        if (ids.length < 1 || ids.length > 50)
          throw gqlError('INVALID_INPUT', 'ids must hold between 1 and 50 issues');
        const rows = [];
        for (const id of ids) {
          const row = await findIssue(id, ctx.user.id);
          await assertPermission(row.teamId, ctx.user, 'work_items', 'edit');
          rows.push(row);
        }
        const patch = toPatch(input);
        for (const row of rows) await validateIssuePatch(row.id, patch);
        for (const row of rows) await updateIssue(row.id, patch, ctx.user.id);
        const issues = [];
        for (const row of rows) issues.push(await issueById(row.id));
        return { success: true, lastSyncId: lastSyncId(), issues };
      }),

    issueArchive: async (_: unknown, { id }: { id: string }, ctx: GraphQLContext) =>
      guard(async () => {
        const row = await findIssue(id, ctx.user.id);
        await assertPermission(row.teamId, ctx.user, 'work_items', 'edit');
        await archiveIssue(row.id, ctx.user.id);
        return { success: true, lastSyncId: lastSyncId(), entity: await issueById(row.id) };
      }),

    issueUnarchive: async (_: unknown, { id }: { id: string }, ctx: GraphQLContext) =>
      guard(async () => {
        const row = await findIssue(id, ctx.user.id);
        await assertPermission(row.teamId, ctx.user, 'work_items', 'edit');
        await restoreIssue(row.id, ctx.user.id);
        return { success: true, lastSyncId: lastSyncId(), entity: await issueById(row.id) };
      }),

    // There is no trash: delete removes the issue, as REST does, and purges its
    // attachment objects best-effort.
    issueDelete: async (_: unknown, { id }: { id: string }, ctx: GraphQLContext) =>
      guard(async () => {
        const row = await findIssue(id, ctx.user.id);
        await assertPermission(row.teamId, ctx.user, 'work_items', 'delete');
        const entity = toIssue(row);
        const attachments = await deleteIssue(row.id, ctx.user.id);
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
        if (!input.name) throw gqlError('INVALID_INPUT', 'input.name must not be empty');
        if (!STATE_TYPES.has(input.type))
          throw gqlError('INVALID_INPUT', `input.type ${input.type} is not supported`);
        const team = await findTeam(input.teamId, ctx.user.id);
        await assertPermission(team.id, ctx.user, 'states', 'create');
        const column = await createState({
          teamId: team.id,
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
        if (input.name === '') throw gqlError('INVALID_INPUT', 'input.name must not be empty');
        const state = await findState(id, ctx.user.id);
        await assertPermission(state.teamId, ctx.user, 'states', 'edit');
        await updateState(state.id, state.teamId, {
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
        await assertPermission(state.teamId, ctx.user, 'states', 'edit');
        await archiveState(state.id, state.teamId);
        return { success: true, lastSyncId: lastSyncId(), entity: await stateById(state.id) };
      }),
  },
};

async function stateById(id: string) {
  const [row] = await db.select().from(workflowState).where(eq(workflowState.id, id));
  return toWorkflowState(row!);
}
