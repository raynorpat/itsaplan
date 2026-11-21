import { db, feedEntry, issue, issueActivity, projectUpdate, team, user } from '@repo/db';
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { iso } from '../shared/lib';

// A project's activity feed reads the feed_entry view (change log and comments):
// entries of the project itself (project_id set), comments on its project updates
// (project_update_id set), and the entries of the issues linked to it (issue_id
// set, resolved through issue.project_id). It is one keyset-paginated query over a
// single (created_at, id) order. Project-level events are written by
// recordActivity/logProjectUpdate.

export type FeedKind = 'comment' | 'activity';

export interface ProjectFeedItemRow {
  id: string;
  // 'project' for an event of the project itself, 'issue' for the activity
  // of a linked issue. Derived from which owner column is set.
  source: 'project' | 'issue';
  kind: FeedKind;
  actorUserId: string | null;
  actorName: string | null;
  body: string | null;
  action: string | null;
  subject: string | null;
  fromText: string | null;
  toText: string | null;
  createdAt: string;
  // Set only for 'issue' rows, so the UI can link the entry to its issue.
  issueId: string | null;
  issueIdentifier: string | null;
}

// Opaque page cursor: the (created_at, id) of the last returned item. id breaks
// ties when two entries share a created_at (bulk activity from one edit).
export interface FeedCursor {
  ts: string;
  id: string;
}

export interface FeedPage {
  items: ProjectFeedItemRow[];
  nextCursor: FeedCursor | null;
}

// An id no row has, for `IN` lists that would otherwise be empty.
const NO_ID = '00000000-0000-0000-0000-000000000000';

// One page of a project's feed, newest first: the project's own activity and the
// activity of its issues in `issueTeamIds` (the teams the viewer can see).
// limit is clamped to 1..100.
export async function listFeed(
  projectId: string,
  issueTeamIds: string[],
  opts: { before?: FeedCursor | null; limit?: number } = {},
): Promise<FeedPage> {
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);
  const before = opts.before ?? null;
  const linkedIssueIds = db
    .select({ id: issue.id })
    .from(issue)
    .where(
      and(
        eq(issue.projectId, projectId),
        inArray(issue.teamId, issueTeamIds.length ? issueTeamIds : [NO_ID]),
      ),
    );
  const projectUpdateIds = db
    .select({ id: projectUpdate.id })
    .from(projectUpdate)
    .where(eq(projectUpdate.projectId, projectId));
  const rows = await db
    .select({
      id: feedEntry.id,
      issueId: feedEntry.issueId,
      projectId: feedEntry.projectId,
      kind: feedEntry.kind,
      actorUserId: feedEntry.actorUserId,
      actorName: feedEntry.actorName,
      body: feedEntry.body,
      action: feedEntry.action,
      subject: feedEntry.subject,
      fromText: feedEntry.fromText,
      toText: feedEntry.toText,
      createdAt: feedEntry.createdAt,
      cursorTs: sql<string>`${feedEntry.createdAt}::text`,
      seq: issue.sequenceNumber,
      teamKey: team.key,
    })
    .from(feedEntry)
    .leftJoin(issue, eq(issue.id, feedEntry.issueId))
    .leftJoin(team, eq(team.id, issue.teamId))
    .where(
      and(
        or(
          eq(feedEntry.projectId, projectId),
          inArray(feedEntry.issueId, linkedIssueIds),
          inArray(feedEntry.projectUpdateId, projectUpdateIds),
        ),
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
    items: page.map((row) => ({
      id: row.id,
      source: row.issueId == null ? ('project' as const) : ('issue' as const),
      kind: row.kind as FeedKind,
      actorUserId: row.actorUserId,
      actorName: row.actorName,
      body: row.body,
      action: row.action,
      subject: row.subject,
      fromText: row.fromText,
      toText: row.toText,
      createdAt: iso(row.createdAt),
      issueId: row.issueId,
      issueIdentifier: row.seq != null && row.teamKey ? `${row.teamKey}-${row.seq}` : null,
    })),
    nextCursor: hasMore && last ? { ts: last.cursorTs, id: last.id } : null,
  };
}

// --- Activity log ----------------------------------------------------------------
// recordActivity writes project-level change-log entries (kind 'activity',
// project_id set). The project mutation functions call it.

export interface ActivityInput {
  action: string;
  subject?: string | null;
  fromText?: string | null;
  toText?: string | null;
}

async function userName(id: string | null): Promise<string | null> {
  if (id == null) return null;
  const rows = await db.select({ name: user.name }).from(user).where(eq(user.id, id));
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
  if (before.status !== after.status)
    events.push({ action: 'status', fromText: before.status, toText: after.status });
  if (before.leadUserId !== after.leadUserId)
    events.push({
      action: 'lead',
      fromText: await userName(before.leadUserId),
      toText: await userName(after.leadUserId),
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
