import { db, notificationDelivery, issue, team, user } from '@repo/db';
import { eq, inArray } from 'drizzle-orm';
import { getNotificationEmailConfig } from '@repo/auth';
import { CATEGORY_OF, getEmailCategoriesForUsers } from '../notification-preferences/store';
import type { NotificationType, NewNotificationRow } from './store';

// Outbound notification delivery: turns the inbox notification rows produced by an
// issue event into notification_delivery outbox rows. Delivery is per member and per
// their own preferences: for each inbox row (already one per recipient), the member's
// notification preferences decide whether it goes by email to their account address.
// Email is sent through the instance email provider. The message text is composed
// here at enqueue time and stored on the row; the worker drains the outbox and the
// sender reads the credentials at send time.
//
// This is best-effort: enqueue never throws into the caller (a failure here must not
// break creating a comment or updating an issue), so callers wrap it in try/catch.

// The stored message. The sender builds the HTML body from `text` and appends `url`.
export interface DeliveryPayload {
  subject?: string;
  text: string;
  url?: string;
}

interface OutboxRow {
  teamId: string;
  channel: 'email';
  recipient: string;
  payload: DeliveryPayload;
}

// The issue reference shown in messages, e.g. "IAP-42".
function issueRef(teamKey: string, seq: number): string {
  return `${teamKey}-${seq}`;
}

// The public URL of an issue, or undefined when the web origin is not configured
// (then messages carry no link rather than a localhost fallback).
function issueUrl(teamKey: string, seq: number): string | undefined {
  const base = process.env.APP_URL;
  return base ? `${base}/team/${teamKey}/issue/${seq}` : undefined;
}

// Email copy, addressed to the recipient in the second person.
function emailPayload(
  type: NotificationType,
  ref: string,
  title: string,
  actor: string,
  url: string | undefined,
): DeliveryPayload {
  const line: Record<NotificationType, { subject: string; text: string }> = {
    assigned: { subject: `${ref}: assigned to you`, text: `${actor} assigned this issue to you.` },
    mentioned: {
      subject: `${ref}: you were mentioned`,
      text: `${actor} mentioned you in a comment.`,
    },
    commented: { subject: `${ref}: new comment`, text: `${actor} commented on this issue.` },
    state_changed: {
      subject: `${ref}: status changed`,
      text: `${actor} changed the status of this issue.`,
    },
  };
  const { subject, text } = line[type];
  return { subject, text: `${text}\n\n${ref}: ${title}`, url };
}

// Enqueues outbound delivery rows for the inbox notifications just created for one
// issue event. All rows in `notifications` share the same issue and actor (both call
// sites operate on a single issue). No-op when no instance email provider is
// configured or no member wants any of the event types present.
export async function enqueueOutbound(
  notifications: NewNotificationRow[],
  actorName: string | null,
): Promise<void> {
  if (notifications.length === 0) return;
  const teamId = notifications[0].teamId;

  if (!(await getNotificationEmailConfig())) return;

  const issueId = notifications[0].issueId;
  const [issueRow] = await db
    .select({ seq: issue.sequenceNumber, title: issue.title })
    .from(issue)
    .where(eq(issue.id, issueId));
  const [teamRow] = await db
    .select({ key: team.key, name: team.name })
    .from(team)
    .where(eq(team.id, teamId));
  if (!issueRow || !teamRow) return;

  const ref = issueRef(teamRow.key, issueRow.seq);
  const url = issueUrl(teamRow.key, issueRow.seq);
  const actor = actorName ?? 'Someone';

  const userIds = [...new Set(notifications.map((n) => n.userId))];
  const [users, prefsByUser] = await Promise.all([
    db.select({ id: user.id, email: user.email }).from(user).where(inArray(user.id, userIds)),
    getEmailCategoriesForUsers(userIds),
  ]);
  const emailById = new Map(users.map((u) => [u.id, u.email]));

  const out: OutboxRow[] = [];
  for (const n of notifications) {
    const prefs = prefsByUser.get(n.userId);
    if (prefs?.[CATEGORY_OF[n.type]]) {
      const email = emailById.get(n.userId);
      if (email) {
        out.push({
          teamId,
          channel: 'email',
          recipient: email,
          payload: emailPayload(n.type, ref, issueRow.title, actor, url),
        });
      }
    }
  }

  if (out.length === 0) return;
  await db.insert(notificationDelivery).values(out);
}
