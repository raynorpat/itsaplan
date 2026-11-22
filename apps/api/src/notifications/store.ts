import { db, notification, teamMember, user, issue, team, workflowState } from '@repo/db';
import { and, desc, eq, inArray, lt, or, sql, isNull } from 'drizzle-orm';
import { parseMentions } from '../ai-agents/mentions';
import { iso } from '../shared/lib';
import { enqueueOutbound } from './outbound';
import { subscribe, subscriberIds } from './subscriptions';

// Inbox notifications. A notification is one (recipient, event) row: a user is told
// about an issue they are involved in. Comment and status-change notifications go to
// the issue's subscribers (./subscriptions.ts); assignment and mention notifications
// to the assignee and the mentioned members. The actor is never notified about their
// own action, and only team members receive notifications, so agent bot users
// (assigned via delegate, not members) are excluded.

export type NotificationType = 'assigned' | 'mentioned' | 'commented' | 'state_changed';

export interface NewNotificationRow {
  userId: string;
  teamId: string;
  issueId: string;
  sourceActivityId?: string | null;
  sourceCommentId?: string | null;
  type: NotificationType;
  actorUserId: string | null;
}

// Keeps only the ids that are members of the team. Filters out non-members (an
// agent's bot user is assigned via delegate but is not a member) and users who have
// lost access.
async function keepTeamMembers(teamId: string, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db
    .select({ userId: teamMember.userId })
    .from(teamMember)
    .where(and(eq(teamMember.teamId, teamId), inArray(teamMember.userId, ids)));
  return new Set(rows.map((r) => r.userId));
}

async function actorName(id: string | null): Promise<string | null> {
  if (id == null) return null;
  const rows = await db.select({ name: user.name }).from(user).where(eq(user.id, id));
  return rows[0]?.name ?? null;
}

async function insertNotifications(rows: NewNotificationRow[]): Promise<void> {
  if (rows.length === 0) return;
  const name = await actorName(rows[0].actorUserId);
  await db.insert(notification).values(rows.map((r) => ({ ...r, actorName: name })));
  // Fan out to the team's enabled delivery channels (email, Telegram). Best-effort:
  // a delivery failure must not break the inbox insert or the domain mutation.
  try {
    await enqueueOutbound(rows, name);
  } catch (err) {
    console.error('[notifications] outbound enqueue failed:', err);
  }
}

// Fan out a new comment. Mentioned members get a 'mentioned' notification; the other
// participants get 'commented'. A mentioned user gets only the 'mentioned' one. The
// comment author is never notified. `onlyMentioned` (an edit) notifies just those
// newly mentioned members and no participants.
export async function notifyComment(
  teamId: string,
  comment: { issueId: string | null; id: string; userId: string | null; body: string },
  opts: { onlyMentioned?: string[] } = {},
): Promise<void> {
  if (!comment.issueId) return;
  const actor = comment.userId;
  let mentionedIds = parseMentions(comment.body);
  if (opts.onlyMentioned)
    mentionedIds = mentionedIds.filter((id) => opts.onlyMentioned!.includes(id));
  const mentioned = await keepTeamMembers(teamId, mentionedIds);
  // Linear subscribes the comment's author and the members it mentions.
  await subscribe(comment.issueId, [
    ...(actor && !opts.onlyMentioned ? [actor] : []),
    ...mentioned,
  ]);
  const participants = opts.onlyMentioned
    ? new Set<string>()
    : new Set(await subscriberIds(comment.issueId));

  const rows: NewNotificationRow[] = [];
  for (const userId of mentioned) {
    if (userId === actor) continue;
    rows.push({
      userId,
      teamId,
      issueId: comment.issueId,
      sourceCommentId: comment.id,
      type: 'mentioned',
      actorUserId: actor,
    });
  }
  for (const userId of participants) {
    if (userId === actor || mentioned.has(userId)) continue;
    rows.push({
      userId,
      teamId,
      issueId: comment.issueId,
      sourceCommentId: comment.id,
      type: 'commented',
      actorUserId: actor,
    });
  }
  await insertNotifications(rows);
}

// Fan out issue field changes recorded by an update. A new assignee (if a member and
// not the actor) gets 'assigned'; a status change notifies the issue's participants
// with 'state_changed'. The actor is never notified.
export async function notifyIssueChange(input: {
  teamId: string;
  issueId: string;
  actorUserId: string | null;
  assignedUserId?: string | null;
  assignedActivityId?: string | null;
  statusChanged?: boolean;
  statusActivityId?: string | null;
}): Promise<void> {
  const { teamId, issueId, actorUserId: actor } = input;
  const rows: NewNotificationRow[] = [];

  // Linear subscribes a new assignee.
  if (input.assignedUserId) await subscribe(issueId, [input.assignedUserId]);

  if (input.assignedUserId && input.assignedUserId !== actor) {
    const members = await keepTeamMembers(teamId, [input.assignedUserId]);
    if (members.has(input.assignedUserId)) {
      rows.push({
        userId: input.assignedUserId,
        teamId,
        issueId,
        sourceActivityId: input.assignedActivityId ?? null,
        type: 'assigned',
        actorUserId: actor,
      });
    }
  }

  if (input.statusChanged) {
    const assigned = input.assignedUserId ?? null;
    for (const userId of await subscriberIds(issueId)) {
      // Skip the actor and anyone already told they were just assigned.
      if (userId === actor || userId === assigned) continue;
      rows.push({
        userId,
        teamId,
        issueId,
        sourceActivityId: input.statusActivityId ?? null,
        type: 'state_changed',
        actorUserId: actor,
      });
    }
  }

  await insertNotifications(rows);
}

// --- Inbox read + mutations ------------------------------------------------------

// A notification enriched with the issue and team it points at, so the inbox can
// render a row (identifier, title, team, actor, status) without extra calls.
export interface NotificationRow {
  id: string;
  type: NotificationType;
  actorUserId: string | null;
  actorName: string | null;
  readAt: string | null;
  snoozedUntil: string | null;
  createdAt: string;
  issueId: string;
  issueSeq: number;
  issueTitle: string;
  issueStateType: string;
  teamId: string;
  teamKey: string;
  teamName: string;
}

export interface NotificationCursor {
  ts: string;
  id: string;
}

export interface NotificationPage {
  items: NotificationRow[];
  nextCursor: NotificationCursor | null;
}

export interface NotificationFilters {
  types?: NotificationType[];
  fromUserId?: string;
  teamId?: string;
  includeRead?: boolean;
  includeSnoozed?: boolean;
}

function mapRow(r: {
  id: string;
  type: string;
  actorUserId: string | null;
  actorName: string | null;
  readAt: Date | null;
  snoozedUntil: Date | null;
  createdAt: Date;
  issueId: string;
  issueSeq: number;
  issueTitle: string;
  issueStateType: string;
  teamId: string;
  teamKey: string;
  teamName: string;
}): NotificationRow {
  return {
    id: r.id,
    type: r.type as NotificationType,
    actorUserId: r.actorUserId,
    actorName: r.actorName,
    readAt: r.readAt ? iso(r.readAt) : null,
    snoozedUntil: r.snoozedUntil ? iso(r.snoozedUntil) : null,
    createdAt: iso(r.createdAt),
    issueId: r.issueId,
    issueSeq: r.issueSeq,
    issueTitle: r.issueTitle,
    issueStateType: r.issueStateType,
    teamId: r.teamId,
    teamKey: r.teamKey,
    teamName: r.teamName,
  };
}

// One page of a user's inbox, newest first, keyset-paged on (created_at, id).
// includeRead defaults to true (the inbox shows read notifications too); a snoozed
// notification (snoozed_until still in the future) is hidden unless includeSnoozed.
// limit is clamped to 1..100.
export async function listNotifications(
  userId: string,
  opts: { before?: NotificationCursor | null; limit?: number; filters?: NotificationFilters } = {},
): Promise<NotificationPage> {
  const limit = Math.min(Math.max(opts.limit ?? 30, 1), 100);
  const before = opts.before ?? null;
  const f = opts.filters ?? {};
  const conds = [eq(notification.userId, userId), isNull(notification.archivedAt)];
  if (f.types && f.types.length) conds.push(inArray(notification.type, f.types));
  if (f.fromUserId) conds.push(eq(notification.actorUserId, f.fromUserId));
  if (f.teamId != null) conds.push(eq(notification.teamId, f.teamId));
  if (f.includeRead === false) conds.push(isNull(notification.readAt));
  if (!f.includeSnoozed)
    conds.push(or(isNull(notification.snoozedUntil), lt(notification.snoozedUntil, sql`now()`))!);
  if (before)
    conds.push(
      sql`(${notification.createdAt}, ${notification.id}) < (${before.ts}::timestamptz, ${before.id}::uuid)`,
    );

  const rows = await db
    .select({
      id: notification.id,
      type: notification.type,
      actorUserId: notification.actorUserId,
      actorName: notification.actorName,
      readAt: notification.readAt,
      snoozedUntil: notification.snoozedUntil,
      createdAt: notification.createdAt,
      cursorTs: sql<string>`${notification.createdAt}::text`,
      issueId: issue.id,
      issueSeq: issue.sequenceNumber,
      issueTitle: issue.title,
      issueStateType: workflowState.stateType,
      teamId: team.id,
      teamKey: team.key,
      teamName: team.name,
    })
    .from(notification)
    .innerJoin(issue, eq(issue.id, notification.issueId))
    .innerJoin(team, eq(team.id, notification.teamId))
    .innerJoin(workflowState, eq(workflowState.id, issue.stateId))
    .where(and(...conds))
    .orderBy(desc(notification.createdAt), desc(notification.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  return {
    items: page.map(mapRow),
    nextCursor: hasMore && last ? { ts: last.cursorTs, id: last.id } : null,
  };
}

// The number of unread, non-snoozed notifications for the inbox badge, optionally
// scoped to one team.
export async function unreadCount(userId: string, teamId?: string): Promise<number> {
  const conds = [
    eq(notification.userId, userId),
    isNull(notification.archivedAt),
    isNull(notification.readAt),
    or(isNull(notification.snoozedUntil), lt(notification.snoozedUntil, sql`now()`)),
  ];
  if (teamId != null) conds.push(eq(notification.teamId, teamId));
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(notification)
    .where(and(...conds));
  return row?.n ?? 0;
}

// Cheap change marker for live refresh: total count, newest created_at, and unread
// count, optionally scoped to one team. It moves on a new notification (newest),
// a delete (total), and a read/unread toggle (unread).
export async function notificationsRev(userId: string, teamId?: string): Promise<string> {
  const conds = [eq(notification.userId, userId), isNull(notification.archivedAt)];
  if (teamId != null) conds.push(eq(notification.teamId, teamId));
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      newest: sql<string>`coalesce(max(${notification.createdAt})::text, '')`,
      unread: sql<number>`count(*) filter (where ${notification.readAt} is null)::int`,
    })
    .from(notification)
    .where(and(...conds));
  return `${row?.total ?? 0}:${row?.newest ?? ''}:${row?.unread ?? 0}`;
}

// Marks one of the user's notifications read or unread. Returns false if no such
// notification belongs to the user.
export async function setNotificationRead(
  userId: string,
  id: string,
  read: boolean,
): Promise<boolean> {
  const rows = await db
    .update(notification)
    .set({ readAt: read ? sql`now()` : null })
    .where(and(eq(notification.id, id), eq(notification.userId, userId)))
    .returning({ id: notification.id });
  return rows.length > 0;
}

// Marks every unread notification of the user read, optionally scoped to a team.
// Returns how many were updated.
export async function markAllRead(userId: string, teamId?: string): Promise<number> {
  const conds = [eq(notification.userId, userId), isNull(notification.readAt)];
  if (teamId != null) conds.push(eq(notification.teamId, teamId));
  const rows = await db
    .update(notification)
    .set({ readAt: sql`now()` })
    .where(and(...conds))
    .returning({ id: notification.id });
  return rows.length;
}

// Snoozes one of the user's notifications until the given time (null clears it).
// Returns false if no such notification belongs to the user.
export async function snoozeNotification(
  userId: string,
  id: string,
  until: Date | null,
): Promise<boolean> {
  const rows = await db
    .update(notification)
    .set({ snoozedUntil: until })
    .where(and(eq(notification.id, id), eq(notification.userId, userId)))
    .returning({ id: notification.id });
  return rows.length > 0;
}

// Deletes one of the user's notifications. Returns false if it did not belong to
// the user.
export async function deleteNotification(userId: string, id: string): Promise<boolean> {
  const rows = await db
    .delete(notification)
    .where(and(eq(notification.id, id), eq(notification.userId, userId)))
    .returning({ id: notification.id });
  return rows.length > 0;
}

export type DeleteScope = 'all' | 'read' | 'read-completed';

// Bulk-deletes the user's notifications by scope: all, all read, or all read whose
// issue is in a completed or canceled column. Scoped to one team when teamId
// is given (the per-team inbox). Returns how many were deleted.
export async function deleteNotifications(
  userId: string,
  scope: DeleteScope,
  teamId?: string,
): Promise<number> {
  const conds = [eq(notification.userId, userId)];
  if (teamId != null) conds.push(eq(notification.teamId, teamId));
  if (scope === 'read' || scope === 'read-completed')
    conds.push(sql`${notification.readAt} is not null`);
  if (scope === 'read-completed') {
    // read notifications whose issue sits in a completed/canceled column.
    const completedIssues = db
      .select({ id: issue.id })
      .from(issue)
      .innerJoin(workflowState, eq(workflowState.id, issue.stateId))
      .where(inArray(workflowState.stateType, ['completed', 'canceled']));
    conds.push(inArray(notification.issueId, completedIssues));
  }
  const rows = await db
    .delete(notification)
    .where(and(...conds))
    .returning({ id: notification.id });
  return rows.length;
}
