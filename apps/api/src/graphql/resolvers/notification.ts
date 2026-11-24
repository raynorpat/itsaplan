import { visibleTeamIds } from '../../shared/access';
import { db, notification } from '@repo/db';
import { and, eq, inArray, isNotNull, isNull, type SQL } from 'drizzle-orm';
import { commentParentUrl, getComment } from '../../comments/store';
import {
  getNotificationRecord,
  updateNotificationRecords,
  type NotificationRecord,
} from '../../notifications/store';
import { UUID_RE } from '../../shared/lib';
import type { GraphQLContext } from '../context';
import { paginate, type PageArgs } from '../connection';
import { gqlError } from '../errors';
import { notificationFilterSql } from '../notification-filter';
import { toComment } from './comment';
import { toIssue, userFor } from './issue';
import { loaders } from '../loaders';
import { guard, lastSyncId, onlySupported } from './mutations';
import { toTeam } from './team';

// Linear's Notification API over the inbox. A notification is an IssueNotification,
// or an AgentSessionNotification when it is about an agent session. A viewer reads and changes only their own notifications on
// issues of teams they are a member of, so the issue and team always resolve.

const TYPES: Record<string, { type: string; category: string }> = {
  assigned: { type: 'issueAssignedToYou', category: 'assignments' },
  mentioned: { type: 'issueCommentMention', category: 'mentions' },
  commented: { type: 'issueNewComment', category: 'commentsAndReplies' },
  state_changed: { type: 'issueStatusChanged', category: 'statusChanges' },
  agent_needs_input: { type: 'agentSessionNeedsInput', category: 'appsAndIntegrations' },
  agent_responded: { type: 'agentSessionResponse', category: 'appsAndIntegrations' },
};

export const toNotification = (row: NotificationRecord) => ({
  id: row.id,
  type: TYPES[row.type]!.type,
  category: TYPES[row.type]!.category,
  userId: row.userId,
  actorUserId: row.actorUserId,
  workflowDefinitionId: row.workflowDefinitionId,
  issueId: row.issueId,
  teamId: row.teamId,
  commentId: row.sourceCommentId,
  agentSessionId: row.agentSessionId,
  agentActivityId: row.agentActivityId,
  readAt: row.readAt,
  snoozedUntilAt: row.snoozedUntil,
  archivedAt: row.archivedAt,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  emailedAt: null,
  unsnoozedAt: null,
  reactionEmoji: null,
  subscriptions: [],
});

type GraphQLNotification = ReturnType<typeof toNotification>;
type ListArgs = PageArgs & { filter?: unknown; includeArchived?: boolean | null };

// SQL over `notification`: the viewer's own, on issues of teams they can see.
function ownNotificationsSql(userId: string): SQL {
  return and(
    eq(notification.userId, userId),
    inArray(notification.teamId, visibleTeamIds(userId)),
  )!;
}

async function findNotification(id: string, ctx: GraphQLContext): Promise<NotificationRecord> {
  const found = UUID_RE.test(id) ? await getNotificationRecord(id) : null;
  if (found) {
    const [own] = await db
      .select({ id: notification.id })
      .from(notification)
      .where(and(eq(notification.id, id), ownNotificationsSql(ctx.user.id)));
    if (own) return found;
  }
  throw gqlError('ENTITY_NOT_FOUND', `Notification ${id} not found`);
}

// The viewer's notifications that a NotificationEntityInput names: one by `id`, or
// all about an issue by `issueId`.
function entityWhere(input: Record<string, unknown>, ctx: GraphQLContext): SQL {
  onlySupported(input, ['id', 'issueId'], 'input');
  const parts: SQL[] = [ownNotificationsSql(ctx.user.id)];
  for (const [field, column] of [
    ['id', notification.id],
    ['issueId', notification.issueId],
  ] as const) {
    const value = input[field];
    if (value == null) continue;
    if (!UUID_RE.test(String(value)))
      throw gqlError('INVALID_INPUT', `input.${field} is not a valid id`);
    parts.push(eq(column, String(value)));
  }
  if (parts.length === 1) throw gqlError('INVALID_INPUT', 'Set input.id or input.issueId');
  return and(...parts)!;
}

function toDate(value: unknown, field: string): Date {
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) throw gqlError('INVALID_INPUT', `${field} must be a date`);
  return date;
}

const batch = async (where: SQL, patch: Parameters<typeof updateNotificationRecords>[1]) => ({
  success: true,
  lastSyncId: lastSyncId(),
  notifications: (await updateNotificationRecords(where, patch)).map(toNotification),
});

const commentFor = async (id: string | null) => {
  const row = id ? await getComment(id) : null;
  return row ? toComment(row, await commentParentUrl(row)) : null;
};

export const notificationResolvers = {
  Notification: {
    __resolveType: (n: GraphQLNotification) =>
      n.agentSessionId ? 'AgentSessionNotification' : 'IssueNotification',
  },
  Query: {
    notification: (_: unknown, { id }: { id: string }, ctx: GraphQLContext) =>
      guard(async () => toNotification(await findNotification(id, ctx))),
    notifications: (_: unknown, args: ListArgs, ctx: GraphQLContext) =>
      paginate(
        args,
        {
          id: notification.id,
          createdAt: notification.createdAt,
          updatedAt: notification.updatedAt,
        },
        and(
          ownNotificationsSql(ctx.user.id),
          args.includeArchived ? undefined : isNull(notification.archivedAt),
          notificationFilterSql(args.filter),
        ),
        (w, order, limit) =>
          db
            .select()
            .from(notification)
            .where(w)
            .orderBy(...order)
            .limit(limit),
        toNotification,
      ),
  },
  IssueNotification: {
    // Batched per request; the list is already limited to the viewer's own
    // notifications on teams they can see, so the issue and team are visible.
    user: (n: GraphQLNotification, _: unknown, ctx: GraphQLContext) => userFor(ctx, n.userId),
    actor: (n: GraphQLNotification, _: unknown, ctx: GraphQLContext) => userFor(ctx, n.actorUserId),
    issue: async (n: GraphQLNotification, _: unknown, ctx: GraphQLContext) => {
      const row = await loaders(ctx).issue.load(n.issueId);
      return row ? toIssue(row) : null;
    },
    team: async (n: GraphQLNotification, _: unknown, ctx: GraphQLContext) => {
      const row = await loaders(ctx).team.load(n.teamId);
      return row ? toTeam(row) : null;
    },
    comment: (n: GraphQLNotification) => commentFor(n.commentId),
    parentCommentId: async (n: GraphQLNotification) =>
      n.commentId ? ((await getComment(n.commentId))?.parentId ?? null) : null,
    parentComment: async (n: GraphQLNotification) =>
      n.commentId ? commentFor((await getComment(n.commentId))?.parentId ?? null) : null,
    botActor: (n: GraphQLNotification, _: unknown, ctx: GraphQLContext) =>
      n.workflowDefinitionId ? loaders(ctx).workflowBot.load(n.workflowDefinitionId) : null,
    externalUserActor: () => null,
  },
  AgentSessionNotification: {
    user: (n: GraphQLNotification, _: unknown, ctx: GraphQLContext) => userFor(ctx, n.userId),
    actor: (n: GraphQLNotification, _: unknown, ctx: GraphQLContext) => userFor(ctx, n.actorUserId),
    botActor: () => null,
    externalUserActor: () => null,
  },
  Mutation: {
    notificationUpdate: (
      _: unknown,
      { id, input }: { id: string; input: Record<string, unknown> },
      ctx: GraphQLContext,
    ) =>
      guard(async () => {
        onlySupported(input, ['readAt', 'snoozedUntilAt'], 'input');
        const found = await findNotification(id, ctx);
        const patch: Parameters<typeof updateNotificationRecords>[1] = {};
        if (input.readAt !== undefined)
          patch.readAt = input.readAt === null ? null : toDate(input.readAt, 'input.readAt');
        if (input.snoozedUntilAt !== undefined)
          patch.snoozedUntil =
            input.snoozedUntilAt === null
              ? null
              : toDate(input.snoozedUntilAt, 'input.snoozedUntilAt');
        const [row] = await updateNotificationRecords(eq(notification.id, found.id), patch);
        return { success: true, lastSyncId: lastSyncId(), notification: toNotification(row!) };
      }),
    notificationArchive: (_: unknown, { id }: { id: string }, ctx: GraphQLContext) =>
      guard(async () => {
        const found = await findNotification(id, ctx);
        const [row] = await updateNotificationRecords(eq(notification.id, found.id), {
          archivedAt: found.archivedAt ?? new Date(),
        });
        return { success: true, lastSyncId: lastSyncId(), entity: toNotification(row!) };
      }),
    notificationUnarchive: (_: unknown, { id }: { id: string }, ctx: GraphQLContext) =>
      guard(async () => {
        const found = await findNotification(id, ctx);
        const [row] = await updateNotificationRecords(eq(notification.id, found.id), {
          archivedAt: null,
        });
        return { success: true, lastSyncId: lastSyncId(), entity: toNotification(row!) };
      }),
    notificationMarkReadAll: (
      _: unknown,
      { input, readAt }: { input: Record<string, unknown>; readAt: unknown },
      ctx: GraphQLContext,
    ) =>
      guard(async () =>
        batch(and(entityWhere(input, ctx), isNull(notification.readAt))!, {
          readAt: toDate(readAt, 'readAt'),
        }),
      ),
    notificationMarkUnreadAll: (
      _: unknown,
      { input }: { input: Record<string, unknown> },
      ctx: GraphQLContext,
    ) =>
      guard(async () =>
        batch(and(entityWhere(input, ctx), isNotNull(notification.readAt))!, { readAt: null }),
      ),
    notificationSnoozeAll: (
      _: unknown,
      { input, snoozedUntilAt }: { input: Record<string, unknown>; snoozedUntilAt: unknown },
      ctx: GraphQLContext,
    ) =>
      guard(async () =>
        batch(entityWhere(input, ctx), { snoozedUntil: toDate(snoozedUntilAt, 'snoozedUntilAt') }),
      ),
    notificationUnsnoozeAll: (
      _: unknown,
      { input }: { input: Record<string, unknown> },
      ctx: GraphQLContext,
    ) =>
      guard(async () =>
        batch(and(entityWhere(input, ctx), isNotNull(notification.snoozedUntil))!, {
          snoozedUntil: null,
        }),
      ),
    notificationArchiveAll: (
      _: unknown,
      { input }: { input: Record<string, unknown> },
      ctx: GraphQLContext,
    ) =>
      guard(async () =>
        batch(and(entityWhere(input, ctx), isNull(notification.archivedAt))!, {
          archivedAt: new Date(),
        }),
      ),
  },
};
