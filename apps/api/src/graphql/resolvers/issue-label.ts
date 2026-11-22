import { db, issue, issueLabel, label, team } from '@repo/db';
import { and, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import {
  createLabel,
  deleteLabel,
  getLabel,
  restoreLabel,
  retireLabel,
  updateLabel,
} from '../../labels/store';
import { assertLabelManager } from '../../project-labels/store';
import { assertTeamAccess, visibleTeamIds } from '../../shared/access';
import { rethrowDuplicate, UUID_RE } from '../../shared/lib';
import type { GraphQLContext } from '../context';
import { paginate, type PageArgs } from '../connection';
import { gqlError } from '../errors';
import { issueLabelFilterSql } from '../issue-label-filter';
import { listIssues, userById } from './issue';
import { guard, lastSyncId, onlySupported } from './mutations';
import { toTeam } from './team';

// Linear's IssueLabel over a label row. A group is a label with isGroup; a grouped
// label's parentId is its group; a workspace label has no team.
export function toIssueLabel(row: typeof label.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    description: row.description,
    isGroup: row.isGroup,
    parentId: row.parentId,
    teamId: row.teamId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    archivedAt: null,
    retiredAt: row.retiredAt?.toISOString() ?? null,
    // Read by the relation resolvers; not schema fields.
    creatorUserId: row.creatorUserId,
  };
}

// --- Queries, relations and mutations -------------------------------------------

type GraphQLIssueLabel = ReturnType<typeof toIssueLabel>;
type ConnectionArgs = PageArgs & { filter?: unknown };

// The labels a user can see: the labels of the teams they can see, and workspace
// labels once they can see any team.
function visibleLabels(userId: string): SQL {
  const teams = visibleTeamIds(userId);
  return or(inArray(label.teamId, teams), and(isNull(label.teamId), sql`EXISTS (${teams})`))!;
}

function listLabels(where: SQL | undefined, args: ConnectionArgs, ctx: GraphQLContext) {
  return paginate(
    args,
    { id: label.id, createdAt: label.createdAt, updatedAt: label.updatedAt },
    and(visibleLabels(ctx.user.id), where, issueLabelFilterSql(args.filter)),
    (w, order, limit) =>
      db
        .select()
        .from(label)
        .where(w)
        .orderBy(...order)
        .limit(limit),
    (row) => toIssueLabel(row),
  );
}

async function visibleLabel(id: string, ctx: GraphQLContext) {
  const [row] = UUID_RE.test(id)
    ? await db
        .select()
        .from(label)
        .where(and(eq(label.id, id), visibleLabels(ctx.user.id)))
    : [];
  if (!row) throw gqlError('ENTITY_NOT_FOUND', `Issue label ${id} not found`);
  return row;
}

// Writes to a team label need a team manager; workspace labels need a workspace
// role above guest (the project-labels rule).
async function assertLabelWrite(teamId: string | null, ctx: GraphQLContext) {
  if (teamId) await assertTeamAccess(teamId, ctx.user, 'manage');
  else await assertLabelManager(ctx.user.id);
}

const labelPayload = async (id: string) => {
  const row = await getLabel(id);
  return { success: true, lastSyncId: lastSyncId(), issueLabel: toIssueLabel(row!) };
};

type LabelInput = Record<string, unknown> & {
  name?: string;
  color?: string;
  description?: string | null;
  teamId?: string | null;
  parentId?: string | null;
  isGroup?: boolean;
  id?: string;
};

function assertIds(input: LabelInput) {
  for (const v of [input.teamId, input.parentId, input.id])
    if (v && !UUID_RE.test(v)) throw gqlError('INVALID_INPUT', `${v} is not a valid id`);
}

export const issueLabelResolvers = {
  Query: {
    issueLabel: (_: unknown, { id }: { id: string }, ctx: GraphQLContext) =>
      guard(async () => toIssueLabel(await visibleLabel(id, ctx))),
    issueLabels: (_: unknown, args: ConnectionArgs, ctx: GraphQLContext) =>
      listLabels(undefined, args, ctx),
  },
  Team: {
    labels: (t: { id: string }, args: ConnectionArgs, ctx: GraphQLContext) =>
      listLabels(or(eq(label.teamId, t.id), isNull(label.teamId)), args, ctx),
  },
  Issue: {
    labels: (i: { id: string }, args: ConnectionArgs, ctx: GraphQLContext) =>
      listLabels(
        inArray(
          label.id,
          db
            .select({ id: issueLabel.labelId })
            .from(issueLabel)
            .where(eq(issueLabel.issueId, i.id)),
        ),
        args,
        ctx,
      ),
    labelIds: async (i: { id: string }) => {
      const rows = await db
        .select({ id: issueLabel.labelId })
        .from(issueLabel)
        .where(eq(issueLabel.issueId, i.id));
      return rows.map((r) => r.id).sort();
    },
  },
  IssueLabel: {
    team: async (l: GraphQLIssueLabel) => {
      if (!l.teamId) return null;
      const [row] = await db.select().from(team).where(eq(team.id, l.teamId));
      return row ? toTeam(row) : null;
    },
    parent: async (l: GraphQLIssueLabel) => {
      if (!l.parentId) return null;
      const row = await getLabel(l.parentId);
      return row ? toIssueLabel(row) : null;
    },
    children: (l: GraphQLIssueLabel, args: ConnectionArgs, ctx: GraphQLContext) =>
      listLabels(eq(label.parentId, l.id), args, ctx),
    creator: (l: GraphQLIssueLabel, _: unknown, ctx: GraphQLContext) =>
      userById(l.creatorUserId, ctx.user.id),
    issues: (l: GraphQLIssueLabel, args: PageArgs & { filter?: unknown }, ctx: GraphQLContext) =>
      listIssues(
        inArray(
          issue.id,
          db
            .select({ id: issueLabel.issueId })
            .from(issueLabel)
            .where(eq(issueLabel.labelId, l.id)),
        ),
        args,
        ctx.user.id,
      ),
  },
  Mutation: {
    issueLabelCreate: (_: unknown, { input }: { input: LabelInput }, ctx: GraphQLContext) =>
      guard(async () => {
        onlySupported(
          input,
          ['name', 'color', 'description', 'teamId', 'parentId', 'isGroup', 'id'],
          'input',
        );
        if (!input.name) throw gqlError('INVALID_INPUT', 'input.name is required');
        assertIds(input);
        await assertLabelWrite(input.teamId ?? null, ctx);
        try {
          const created = await createLabel({
            teamId: input.teamId ?? null,
            name: input.name,
            color: input.color,
            groupId: input.parentId,
            description: input.description,
            isGroup: input.isGroup,
            actorUserId: ctx.user.id,
            id: input.id,
          });
          return labelPayload(created.id);
        } catch (err) {
          rethrowDuplicate(err, 'label');
        }
      }),
    issueLabelUpdate: (
      _: unknown,
      { id, input }: { id: string; input: LabelInput },
      ctx: GraphQLContext,
    ) =>
      guard(async () => {
        onlySupported(input, ['name', 'color', 'description', 'parentId'], 'input');
        if (input.name === '') throw gqlError('INVALID_INPUT', 'input.name must not be empty');
        assertIds(input);
        const found = await visibleLabel(id, ctx);
        await assertLabelWrite(found.teamId, ctx);
        try {
          await updateLabel(
            id,
            found.teamId,
            {
              name: input.name,
              color: input.color,
              description: input.description,
              groupId: input.parentId,
            },
            ctx.user.id,
          );
        } catch (err) {
          rethrowDuplicate(err, 'label');
        }
        return labelPayload(id);
      }),
    issueLabelDelete: (_: unknown, { id }: { id: string }, ctx: GraphQLContext) =>
      guard(async () => {
        const found = await visibleLabel(id, ctx);
        await assertLabelWrite(found.teamId, ctx);
        await deleteLabel(id, found.teamId, ctx.user.id);
        return { success: true, lastSyncId: lastSyncId(), entityId: id };
      }),
    issueLabelRetire: (_: unknown, { id }: { id: string }, ctx: GraphQLContext) =>
      guard(async () => {
        const found = await visibleLabel(id, ctx);
        await assertLabelWrite(found.teamId, ctx);
        await retireLabel(id, ctx.user.id);
        return labelPayload(id);
      }),
    issueLabelRestore: (_: unknown, { id }: { id: string }, ctx: GraphQLContext) =>
      guard(async () => {
        const found = await visibleLabel(id, ctx);
        await assertLabelWrite(found.teamId, ctx);
        await restoreLabel(id, ctx.user.id);
        return labelPayload(id);
      }),
  },
};
