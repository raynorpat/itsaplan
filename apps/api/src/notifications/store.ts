import { db, notification, teamMember, user, issue } from '@repo/db';
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { parseMentions } from '../shared/mentions';
import { enqueueOutbound } from './outbound';
import { subscribe, subscriberIds } from './subscriptions';
import { visibleTeamIds } from '../shared/access';
import { currentImport, currentWorkflow } from '../shared/workflow-context';
import { shownNameSql } from '../shared/user-name';

// Inbox notifications. A notification is one (recipient, event) row: a user is told
// about an issue they are involved in. Comment and status-change notifications go to
// the issue's subscribers (./subscriptions.ts); assignment and mention notifications
// to the assignee and the mentioned members. The actor is never notified about their
// own action, and only team members receive notifications.

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

// Keeps only the ids that are members of the team, dropping users who have lost
// access.
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
  const rows = await db.select({ name: shownNameSql }).from(user).where(eq(user.id, id));
  return rows[0]?.name ?? null;
}

async function insertNotifications(all: NewNotificationRow[]): Promise<void> {
  // An import notifies no one (shared/workflow-context.ts).
  if (all.length === 0 || currentImport()) return;
  // A suspended user receives no notifications.
  const suspended = await db
    .select({ id: user.id })
    .from(user)
    .where(
      and(
        inArray(
          user.id,
          all.map((r) => r.userId),
        ),
        sql`${user.suspendedAt} IS NOT NULL`,
      ),
    );
  const skip = new Set(suspended.map((r) => r.id));
  const rows = all.filter((r) => !skip.has(r.userId));
  if (rows.length === 0) return;
  // A change a workflow made has no user actor; the notification names the workflow.
  const workflow = currentWorkflow();
  const name =
    workflow && !rows[0].actorUserId ? workflow.name : await actorName(rows[0].actorUserId);
  const workflowDefinitionId = workflow && !rows[0].actorUserId ? workflow.id : null;
  await db
    .insert(notification)
    .values(rows.map((r) => ({ ...r, actorName: name, workflowDefinitionId })));
  // Queue notification email for members who want it. Best-effort:
  // a delivery failure must not break the inbox insert or the domain mutation.
  try {
    await enqueueOutbound(rows, name, workflowDefinitionId != null);
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
  opts: { onlyMentioned?: string[]; mentions?: boolean } = {},
): Promise<void> {
  if (!comment.issueId) return;
  const actor = comment.userId;
  // `mentions: false` ignores the mentions in the body (a portal visitor's comment).
  let mentionedIds = opts.mentions === false ? [] : parseMentions(comment.body);
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

// Linear's AgentSessionNotification: the person who started an agent session is told
// when its agent asks for input (an elicitation) or answers (a response that ends the
// turn). Only a person who can still see the issue's team and is not suspended is
// notified. These go to the inbox only, not by email.
export type AgentNotificationType = 'agent_needs_input' | 'agent_responded';

export async function notifyAgentSession(input: {
  type: AgentNotificationType;
  recipientId: string | null;
  appUserId: string;
  issueId: string;
  sessionId: string;
  activityId: string;
}): Promise<void> {
  if (!input.recipientId || input.recipientId === input.appUserId || currentImport()) return;
  const [row] = await db
    .select({ teamId: issue.teamId })
    .from(issue)
    .where(
      and(eq(issue.id, input.issueId), inArray(issue.teamId, visibleTeamIds(input.recipientId))),
    );
  if (!row) return;
  const [recipient] = await db
    .select({ suspendedAt: user.suspendedAt })
    .from(user)
    .where(eq(user.id, input.recipientId));
  if (!recipient || recipient.suspendedAt) return;
  await db.insert(notification).values({
    userId: input.recipientId,
    teamId: row.teamId,
    issueId: input.issueId,
    type: input.type,
    agentSessionId: input.sessionId,
    agentActivityId: input.activityId,
    actorUserId: input.appUserId,
    actorName: await actorName(input.appUserId),
  });
}

// --- Inbox read + mutations ------------------------------------------------------

// --- Linear's Notification API ----------------------------------------------------

export type NotificationRecord = typeof notification.$inferSelect;

export async function getNotificationRecord(id: string): Promise<NotificationRecord | null> {
  const [row] = await db.select().from(notification).where(eq(notification.id, id));
  return row ?? null;
}

// Sets read / snooze / archive fields on the notifications `where` selects and bumps
// updated_at. Returns the changed rows.
export async function updateNotificationRecords(
  where: SQL,
  patch: { readAt?: Date | null; snoozedUntil?: Date | null; archivedAt?: Date | null },
): Promise<NotificationRecord[]> {
  return db
    .update(notification)
    .set({ ...patch, updatedAt: sql`now()` })
    .where(where)
    .returning();
}
