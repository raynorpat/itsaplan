import {
  cycle,
  db,
  feedEntry,
  issue,
  issueActivity,
  user,
  workflowState,
  label,
  project,
} from '@repo/db';
import { and, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { HttpError, iso } from '../shared/lib';
import { notifyIssueChange } from '../notifications/store';

// Issue timeline: change-log entries (issue_activity) and comments (comment), read
// together through the feed_entry view. kind selects which payload columns a row
// uses. The author is the session user; the author's name is a snapshot taken at
// write time, so an entry keeps reading correctly after that user is renamed or
// deleted. The issue detail panel renders
// the feed newest first and pages through it with a (created_at, id) keyset cursor.

export type FeedKind = 'comment' | 'activity';

export interface FeedItemRow {
  id: string;
  issueId: string;
  kind: FeedKind;
  actorUserId: string | null;
  actorName: string | null;
  body: string | null;
  action: string | null;
  subject: string | null;
  fromText: string | null;
  toText: string | null;
  // Comments only: the thread root a reply belongs to, and when it was last edited.
  parentId: string | null;
  editedAt: string | null;
  createdAt: string;
}

// Opaque page cursor: the (created_at, id) of the last returned item. id breaks
// ties when two entries share a created_at (bulk activity from one edit).
export interface FeedCursor {
  ts: string;
  id: string;
}

export interface FeedPage {
  items: FeedItemRow[];
  nextCursor: FeedCursor | null;
}

export function mapFeedItem(row: {
  id: string;
  // Nullable at the column level (project rows share the view), but the issue
  // feeds only read issue rows, so it is present.
  issueId: string | null;
  kind: string;
  actorUserId: string | null;
  actorName: string | null;
  body: string | null;
  action: string | null;
  subject: string | null;
  fromText: string | null;
  toText: string | null;
  parentId: string | null;
  editedAt: Date | null;
  createdAt: Date;
}): FeedItemRow {
  return {
    id: row.id,
    issueId: row.issueId as string,
    kind: row.kind as FeedKind,
    actorUserId: row.actorUserId,
    actorName: row.actorName,
    body: row.body,
    action: row.action,
    subject: row.subject,
    fromText: row.fromText,
    toText: row.toText,
    parentId: row.parentId,
    editedAt: row.editedAt ? iso(row.editedAt) : null,
    createdAt: iso(row.createdAt),
  };
}

// One page of an issue's feed, newest first. cursor_ts is created_at as full-
// precision text so the returned nextCursor round-trips without the millisecond
// truncation iso() would apply. limit is clamped to 1..100.
export async function listFeed(
  issueId: string,
  opts: { before?: FeedCursor | null; limit?: number } = {},
): Promise<FeedPage> {
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);
  const before = opts.before ?? null;
  const rows = await db
    .select({
      id: feedEntry.id,
      issueId: feedEntry.issueId,
      kind: feedEntry.kind,
      actorUserId: feedEntry.actorUserId,
      actorName: feedEntry.actorName,
      body: feedEntry.body,
      action: feedEntry.action,
      subject: feedEntry.subject,
      fromText: feedEntry.fromText,
      toText: feedEntry.toText,
      parentId: feedEntry.parentId,
      editedAt: feedEntry.editedAt,
      createdAt: feedEntry.createdAt,
      cursorTs: sql<string>`${feedEntry.createdAt}::text`,
    })
    .from(feedEntry)
    .where(
      and(
        eq(feedEntry.issueId, issueId),
        before
          ? sql`(${feedEntry.createdAt}, ${feedEntry.id}) < (${before.ts}::timestamptz, ${before.id}::uuid)`
          : undefined,
      ),
    )
    .orderBy(desc(feedEntry.createdAt), desc(feedEntry.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  return {
    items: page.map(mapFeedItem),
    nextCursor: hasMore && last ? { ts: last.cursorTs, id: last.id } : null,
  };
}

// --- Status timeline --------------------------------------------------------------
// The issue's life split into the stretches it spent in one column. Backs the
// timeline view of the activity section (a lane per column, bars on a time axis).
// The stretches carry no feed entries: what happened inside one is read on demand
// with listFeedRange when the person opens it.

// The feed entries written inside one stretch of the timeline: created at or after
// `from`, and before `to` (absent for the stretch the issue is in now). Oldest
// first, and unpaged — this is the slice of the activity behind a single bar of the
// timeline, opened by a deliberate click. An entry that shares its timestamp with a
// status change belongs to the stretch that change opens, which is what the
// half-open range gives.
export async function listFeedRange(
  issueId: string,
  from: string,
  to?: string | null,
): Promise<FeedItemRow[]> {
  const fromDate = new Date(from);
  const toDate = to ? new Date(to) : null;
  if (Number.isNaN(fromDate.getTime()) || (toDate && Number.isNaN(toDate.getTime())))
    throw new HttpError(400, 'from and to must be ISO datetimes');

  const rows = await db
    .select()
    .from(feedEntry)
    .where(
      and(
        eq(feedEntry.issueId, issueId),
        gte(feedEntry.createdAt, fromDate),
        toDate ? lt(feedEntry.createdAt, toDate) : undefined,
      ),
    )
    .orderBy(feedEntry.createdAt, feedEntry.id);
  return rows.map(mapFeedItem);
}

// --- Activity log ----------------------------------------------------------------
// recordActivity writes change-log entries into the shared feed (kind 'activity');
// the issue mutation functions call it. The issue detail panel renders these
// together with comments as one timeline.

export interface ActivityInput {
  action: string;
  subject?: string | null;
  fromText?: string | null;
  toText?: string | null;
  // Ids of the referenced rows (state, user, project, cycle, label, related issue),
  // read by the GraphQL history; the texts above are their name snapshots.
  fromId?: string | null;
  toId?: string | null;
}

// Records the given events for an issue. actorUserId is the session user behind
// the write (a member or an agent's bot user); it is null for a system write with
// no user. actor_name is snapshotted from that user so the entry survives the user
// being renamed or deleted.
// Where the activity rows are inserted: the db, or a transaction the caller runs.
export type ActivityExecutor = Pick<typeof db, 'insert'>;

export async function recordActivity(
  issueId: string,
  events: ActivityInput[],
  actorUserId?: string | null,
  executor: ActivityExecutor = db,
): Promise<{ id: string; action: string | null }[]> {
  return insertActivity(
    events.map((event) => ({ issueId, event })),
    actorUserId,
    executor,
  );
}

async function insertActivity(
  entries: { issueId: string; event: ActivityInput }[],
  actorUserId?: string | null,
  executor: ActivityExecutor = db,
): Promise<{ id: string; action: string | null }[]> {
  if (!entries.length) return [];
  const resolvedActorId = actorUserId ?? null;
  const actorName = await userName(resolvedActorId);
  return executor
    .insert(issueActivity)
    .values(
      entries.map(({ issueId, event }) => ({
        issueId,
        actorUserId: resolvedActorId,
        actorName,
        action: event.action,
        subject: event.subject ?? null,
        fromText: event.fromText ?? null,
        toText: event.toText ?? null,
        fromId: event.fromId ?? null,
        toId: event.toId ?? null,
      })),
    )
    .returning({ id: issueActivity.id, action: issueActivity.action });
}

// Name snapshots for the referenced rows, resolved at change time so a log entry
// keeps reading correctly after the column/type/user/label is renamed or deleted.
async function columnName(id: string | null): Promise<string | null> {
  if (id == null) return null;
  const rows = await db
    .select({ name: workflowState.name })
    .from(workflowState)
    .where(eq(workflowState.id, id));
  return rows[0]?.name ?? null;
}
async function projectName(id: string | null): Promise<string | null> {
  if (id == null) return null;
  const rows = await db.select({ title: project.name }).from(project).where(eq(project.id, id));
  return rows[0]?.title ?? null;
}
// A cycle's name, or "Cycle <number>" when it has none (Linear's display).
async function cycleName(id: string | null): Promise<string | null> {
  if (id == null) return null;
  const [row] = await db
    .select({ name: cycle.name, number: cycle.number })
    .from(cycle)
    .where(eq(cycle.id, id));
  return row ? (row.name ?? `Cycle ${row.number}`) : null;
}
async function userName(id: string | null): Promise<string | null> {
  if (id == null) return null;
  const rows = await db.select({ name: user.name }).from(user).where(eq(user.id, id));
  return rows[0]?.name ?? null;
}
// Name snapshots for a set of labels in one query, resolved at change time so a log
// entry keeps reading correctly after a label is renamed or deleted. An id outside
// teamId, or with no label at all, is absent from the map.
export async function labelNames(teamId: string, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  const rows = await db
    .select({ id: label.id, name: label.name })
    .from(label)
    .where(and(eq(label.teamId, teamId), inArray(label.id, ids)));
  for (const r of rows) out.set(r.id, r.name);
  return out;
}

// The subset of an issue's fields the change log diffs.
export interface IssueSnapshot {
  id: string;
  title: string;
  description: string;
  stateId: string;
  projectId: string | null;
  cycleId: string | null;
  assigneeUserId: string | null;
  delegateUserId: string | null;
  priority: number;
  dueDate: string | null;
}

// Diffs an issue's before/after state and records one event per changed field.
// Priority and dates are stored as their raw value (the UI maps priority to a
// label and formats dates); description stores only the new value (it is long,
// shown in a popover in the feed). Position is intentionally not logged —
// reordering within a column is not a meaningful change.
export async function logIssueUpdate(
  before: IssueSnapshot,
  after: IssueSnapshot,
  actorUserId?: string | null,
): Promise<void> {
  const events: ActivityInput[] = [];
  if (before.title !== after.title)
    events.push({ action: 'title', fromText: before.title, toText: after.title });
  if (before.description !== after.description)
    events.push({ action: 'description', toText: after.description });
  if (before.stateId !== after.stateId)
    events.push({
      action: 'status',
      fromText: await columnName(before.stateId),
      toText: await columnName(after.stateId),
      fromId: before.stateId,
      toId: after.stateId,
    });
  if (before.projectId !== after.projectId)
    events.push({
      action: 'project',
      fromText: await projectName(before.projectId),
      toText: await projectName(after.projectId),
      fromId: before.projectId,
      toId: after.projectId,
    });
  if (before.cycleId !== after.cycleId)
    events.push({
      action: 'cycle',
      fromText: await cycleName(before.cycleId),
      toText: await cycleName(after.cycleId),
      fromId: before.cycleId,
      toId: after.cycleId,
    });
  if (before.assigneeUserId !== after.assigneeUserId)
    events.push({
      action: 'assignee',
      fromText: await userName(before.assigneeUserId),
      toText: await userName(after.assigneeUserId),
      fromId: before.assigneeUserId,
      toId: after.assigneeUserId,
    });
  if (before.delegateUserId !== after.delegateUserId)
    events.push({
      action: 'delegate',
      fromText: await userName(before.delegateUserId),
      toText: await userName(after.delegateUserId),
      fromId: before.delegateUserId,
      toId: after.delegateUserId,
    });
  if (before.priority !== after.priority)
    events.push({
      action: 'priority',
      fromText: String(before.priority),
      toText: String(after.priority),
    });
  if (before.dueDate !== after.dueDate)
    events.push({ action: 'due_date', fromText: before.dueDate, toText: after.dueDate });
  const inserted = await recordActivity(after.id, events, actorUserId);

  // Inbox notifications for the two events with a dedicated notification type: a new
  // assignee, and a status change. Both link back to their activity row.
  const assigneeChanged = before.assigneeUserId !== after.assigneeUserId;
  const statusChanged = before.stateId !== after.stateId;
  if (assigneeChanged || statusChanged) {
    const idByAction = new Map(inserted.map((r) => [r.action, r.id]));
    const [row] = await db
      .select({ teamId: issue.teamId })
      .from(issue)
      .where(eq(issue.id, after.id));
    if (row) {
      await notifyIssueChange({
        teamId: row.teamId,
        issueId: after.id,
        actorUserId: actorUserId ?? null,
        assignedUserId: assigneeChanged ? after.assigneeUserId : null,
        assignedActivityId: idByAction.get('assignee') ?? null,
        statusChanged,
        statusActivityId: idByAction.get('status') ?? null,
      });
    }
  }
}
