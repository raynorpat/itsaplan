import { db, issueActivity, user } from '@repo/db';
import { eq } from 'drizzle-orm';
import { shownNameSql } from '../shared/user-name';

// recordActivity writes project-level change-log entries (kind 'activity',
// project_id set). The project mutation functions call it.

export interface ActivityInput {
  action: string;
  subject?: string | null;
  fromText?: string | null;
  toText?: string | null;
  // Ids of the referenced rows (project status, user, project label), read by the
  // GraphQL project history.
  fromId?: string | null;
  toId?: string | null;
}

async function userName(id: string | null): Promise<string | null> {
  if (id == null) return null;
  const rows = await db.select({ name: shownNameSql }).from(user).where(eq(user.id, id));
  return rows[0]?.name ?? null;
}

export async function recordActivity(
  projectId: string,
  events: ActivityInput[],
  actorUserId?: string | null,
): Promise<void> {
  if (!events.length) return;
  const resolvedActorId = actorUserId ?? null;
  const actorName = await userName(resolvedActorId);
  await db.insert(issueActivity).values(
    events.map((e) => ({
      issueId: null,
      projectId,
      kind: 'activity' as const,
      actorUserId: resolvedActorId,
      actorName,
      action: e.action,
      subject: e.subject ?? null,
      fromText: e.fromText ?? null,
      toText: e.toText ?? null,
      fromId: e.fromId ?? null,
      toId: e.toId ?? null,
    })),
  );
}

// The subset of a project's fields the change log diffs. status is the status
// type; priority is Linear's 0..4.
export interface ProjectSnapshot {
  id: string;
  name: string;
  content: string;
  status: string;
  statusId: string;
  leadUserId: string | null;
  priority: number;
  startDate: string | null;
  targetDate: string | null;
}

// Diffs a project's before/after state and records one event per changed field.
// The lead resolves to a name snapshot (kept correct after a rename/delete); the
// rest store their raw value (the UI formats status/priority/dates).
export async function logProjectUpdate(
  before: ProjectSnapshot,
  after: ProjectSnapshot,
  actorUserId?: string | null,
): Promise<void> {
  const events: ActivityInput[] = [];
  if (before.name !== after.name)
    events.push({ action: 'name', fromText: before.name, toText: after.name });
  if (before.content !== after.content) events.push({ action: 'content', toText: after.content });
  if (before.statusId !== after.statusId)
    events.push({
      action: 'status',
      fromText: before.status,
      toText: after.status,
      fromId: before.statusId,
      toId: after.statusId,
    });
  if (before.leadUserId !== after.leadUserId)
    events.push({
      action: 'lead',
      fromText: await userName(before.leadUserId),
      toText: await userName(after.leadUserId),
      fromId: before.leadUserId,
      toId: after.leadUserId,
    });
  if (before.priority !== after.priority)
    events.push({
      action: 'priority',
      fromText: String(before.priority),
      toText: String(after.priority),
    });
  if (before.startDate !== after.startDate)
    events.push({ action: 'start_date', fromText: before.startDate, toText: after.startDate });
  if (before.targetDate !== after.targetDate)
    events.push({ action: 'target_date', fromText: before.targetDate, toText: after.targetDate });
  await recordActivity(after.id, events, actorUserId);
}
