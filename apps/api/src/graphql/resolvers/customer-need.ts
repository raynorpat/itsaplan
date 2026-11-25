import { trustedOrigins } from '@repo/auth';
import { customerNeed, db, externalUser } from '@repo/db';
import { and, eq, isNull, sql, type SQL } from 'drizzle-orm';
import { assertFeedbackWrite, readsFeedback, visibleNeedsSql } from '../../feedback/access';
import {
  createNeed,
  deleteNeed,
  mapNeed,
  followMerges,
  setNeedArchived,
  updateNeed,
  type NeedRow,
} from '../../feedback/store';
import { UUID_RE } from '../../shared/lib';
import type { GraphQLContext } from '../context';
import { paginate, type PageArgs } from '../connection';
import { gqlError } from '../errors';
import { needFilterSql } from '../customer-need-filter';
import { getOrganization } from './organization';
import { toAttachment } from './attachment';
import { findIssue, toIssue, userFor } from './issue';
import { loaders } from '../loaders';
import { dateTimeInput, guard, lastSyncId, onlySupported } from './mutations';

// Linear's CustomerNeed as feedback on issues, and ExternalUser as its requester (the
// external creator of the feedback's source attachment). Owners, admins and members
// who can see the issue's team read and write feedback; guests see none of it
// (feedback/access.ts) and get only the counts on issues.

export const toNeed = (row: NeedRow) => ({
  ...row,
  // Linear's content is the feedback's text.
  content: row.body,
  url: `${trustedOrigins[0]}/issue/${row.issueId}?feedback=${row.attachmentId ?? row.id}`,
  customer: null,
  project: null,
  projectAttachment: null,
  comment: null,
  originalIssue: null,
});

type GraphQLNeed = ReturnType<typeof toNeed>;
type ListArgs = PageArgs & { filter?: unknown; includeArchived?: boolean | null };
type Input = Record<string, unknown>;

async function listNeeds(where: SQL | undefined, args: ListArgs, ctx: GraphQLContext) {
  const visible = (await readsFeedback(ctx.user.id)) ? visibleNeedsSql(ctx.user.id) : sql`false`;
  return paginate(
    args,
    { id: customerNeed.id, createdAt: customerNeed.createdAt, updatedAt: customerNeed.updatedAt },
    and(
      visible,
      where,
      args.includeArchived ? undefined : isNull(customerNeed.archivedAt),
      needFilterSql(args.filter, ctx.user.id),
    ),
    (w, order, limit) =>
      db
        .select()
        .from(customerNeed)
        .where(w)
        .orderBy(...order)
        .limit(limit),
    (row) => toNeed(mapNeed(row)),
  );
}

// Feedback the viewer may read, or ENTITY_NOT_FOUND (a guest's or a hidden team's
// answers like a missing one).
async function findNeed(id: string, ctx: GraphQLContext): Promise<NeedRow> {
  const notFound = () => gqlError('ENTITY_NOT_FOUND', `Customer need ${id} not found`);
  if (!UUID_RE.test(id)) throw notFound();
  if (!(await readsFeedback(ctx.user.id))) throw notFound();
  const [row] = await db
    .select()
    .from(customerNeed)
    .where(and(eq(customerNeed.id, id), visibleNeedsSql(ctx.user.id)));
  if (!row) throw notFound();
  return mapNeed(row);
}

const needPayload = (row: NeedRow) => ({
  success: true,
  lastSyncId: lastSyncId(),
  need: toNeed(row),
});

function priorityInput(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (value !== 0 && value !== 1) throw gqlError('INVALID_INPUT', 'priority must be 0 or 1');
  return value;
}

function bodyInput(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return String(value);
}

// The requester (ExternalUser) a merged requester now points at, as Linear's type.
export async function externalUserById(ctx: GraphQLContext, id: string | null) {
  if (!id) return null;
  const row = await followMerges(id, (next) => loaders(ctx).externalUser.load(next));
  return row ? toExternalUser(row) : null;
}

const toExternalUser = (row: typeof externalUser.$inferSelect) => ({
  id: row.id,
  name: row.name,
  displayName: row.displayName,
  email: row.email,
  avatarUrl: row.avatarUrl,
  lastSeen: row.lastSeen.toISOString(),
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  archivedAt: null,
});

export const customerNeedResolvers = {
  Query: {
    customerNeed: async (
      _: unknown,
      args: { id?: string | null; hash?: string | null },
      ctx: GraphQLContext,
    ) => {
      if (!args.id) throw gqlError('INVALID_INPUT', 'Argument id is required');
      return toNeed(await findNeed(args.id, ctx));
    },
    // Without includeArchived, feedback on archived issues is left out too (the board's
    // request counts read only active issues).
    customerNeeds: (_: unknown, args: ListArgs, ctx: GraphQLContext) =>
      listNeeds(
        args.includeArchived
          ? undefined
          : sql`${customerNeed.issueId} IN (SELECT id FROM issue WHERE archived_at IS NULL)`,
        args,
        ctx,
      ),
  },
  Issue: {
    needs: (i: { id: string }, args: ListArgs, ctx: GraphQLContext) =>
      listNeeds(eq(customerNeed.issueId, i.id), args, ctx),
    // The portal visitor who suggested the issue; guests see no requester.
    externalUserCreator: async (
      i: { externalUserCreatorId?: string | null },
      _: unknown,
      ctx: GraphQLContext,
    ) => {
      if (!i.externalUserCreatorId || !(await loaders(ctx).readsFeedback())) return null;
      return externalUserById(ctx, i.externalUserCreatorId);
    },
  },
  CustomerNeed: {
    issue: async (n: GraphQLNeed, _: unknown, ctx: GraphQLContext) => {
      const row = await loaders(ctx).issue.load(n.issueId);
      return row ? toIssue(row) : null;
    },
    attachment: async (n: GraphQLNeed, _: unknown, ctx: GraphQLContext) => {
      if (!n.attachmentId) return null;
      const row = await loaders(ctx).attachment.load(n.attachmentId);
      return row ? toAttachment(row) : null;
    },
    creator: (n: GraphQLNeed, _: unknown, ctx: GraphQLContext) => userFor(ctx, n.creatorId),
  },
  Attachment: {
    // Guests see no requester.
    externalUserCreator: async (
      a: { externalUserCreatorId?: string | null },
      _: unknown,
      ctx: GraphQLContext,
    ) => {
      if (!a.externalUserCreatorId || !(await loaders(ctx).readsFeedback())) return null;
      return externalUserById(ctx, a.externalUserCreatorId);
    },
  },
  ExternalUser: {
    organization: () => getOrganization(),
  },
  Mutation: {
    customerNeedCreate: (_: unknown, { input }: { input: Input }, ctx: GraphQLContext) =>
      guard(async () => {
        onlySupported(
          input,
          ['issueId', 'attachmentId', 'body', 'priority', 'createdAt', 'id'],
          'input',
        );
        if (input.issueId == null)
          throw gqlError(
            'INVALID_INPUT',
            'input.issueId is required: feedback is recorded on an issue',
          );
        if (input.id != null && !UUID_RE.test(String(input.id)))
          throw gqlError('INVALID_INPUT', 'input.id is not a valid id');
        if (input.attachmentId != null && !UUID_RE.test(String(input.attachmentId)))
          throw gqlError('INVALID_INPUT', 'input.attachmentId is not a valid id');
        const issue = await findIssue(String(input.issueId), ctx.user.id);
        await assertFeedbackWrite(issue.id, ctx.user);
        const created = await createNeed({
          id: input.id == null ? undefined : String(input.id),
          issueId: issue.id,
          attachmentId: input.attachmentId == null ? null : String(input.attachmentId),
          body: bodyInput(input.body),
          priority: priorityInput(input.priority),
          creatorId: ctx.user.id,
          createdAt: dateTimeInput(input.createdAt, 'input.createdAt'),
        });
        return needPayload(created);
      }),
    customerNeedUpdate: (
      _: unknown,
      { id, input, clearAttachment }: { id: string; input: Input; clearAttachment?: boolean },
      ctx: GraphQLContext,
    ) =>
      guard(async () => {
        onlySupported(
          input,
          ['body', 'priority', 'issueId', 'applyPriorityToRelatedNeeds'],
          'input',
        );
        if (clearAttachment) throw gqlError('INVALID_INPUT', 'clearAttachment is not supported');
        const found = await findNeed(id, ctx);
        await assertFeedbackWrite(found.issueId, ctx.user);
        let issueId: string | undefined;
        if (input.issueId != null) {
          issueId = (await findIssue(String(input.issueId), ctx.user.id)).id;
          await assertFeedbackWrite(issueId, ctx.user);
        }
        const updated = await updateNeed(
          found.id,
          { body: bodyInput(input.body), priority: priorityInput(input.priority), issueId },
          ctx.user.id,
        );
        return { ...needPayload(updated), updatedRelatedNeeds: [] };
      }),
    customerNeedArchive: (_: unknown, { id }: { id: string }, ctx: GraphQLContext) =>
      guard(async () => {
        const found = await findNeed(id, ctx);
        await assertFeedbackWrite(found.issueId, ctx.user);
        const row = await setNeedArchived(found.id, true, ctx.user.id);
        return { success: true, lastSyncId: lastSyncId(), entity: toNeed(row) };
      }),
    customerNeedUnarchive: (_: unknown, { id }: { id: string }, ctx: GraphQLContext) =>
      guard(async () => {
        const found = await findNeed(id, ctx);
        await assertFeedbackWrite(found.issueId, ctx.user);
        const row = await setNeedArchived(found.id, false, ctx.user.id);
        return { success: true, lastSyncId: lastSyncId(), entity: toNeed(row) };
      }),
    customerNeedDelete: (
      _: unknown,
      { id, keepAttachment }: { id: string; keepAttachment?: boolean | null },
      ctx: GraphQLContext,
    ) =>
      guard(async () => {
        const found = await findNeed(id, ctx);
        await assertFeedbackWrite(found.issueId, ctx.user);
        await deleteNeed(found.id, keepAttachment === true, ctx.user.id);
        return { success: true, lastSyncId: lastSyncId(), entityId: found.id };
      }),
  },
};
