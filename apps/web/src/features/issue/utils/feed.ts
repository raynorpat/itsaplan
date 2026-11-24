import { actorDisplay } from '@/utils/actorDisplay';
import type { FeedItem } from '@/types/issue';
import {
  buildThreads,
  REMOVED_USER,
  type FeedComment,
  type FeedEntry,
  type FeedUser,
} from '@/utils/commentThreads';
import { pagedCutoff } from '@/utils/pagedCutoff';

// The issue feed built from Linear's GraphQL: the issue's comments and its history
// (IssueHistory) as feed rows, newest first. A history entry becomes one or more
// change rows (action + from/to text), so the feed's renderers describe every change
// the same way. Comments are grouped into threads
// (see buildThreads).

interface Named {
  name: string;
}

// The IssueHistory fields the feed reads. A field the entry does not describe is
// absent or null.
export interface FeedHistory {
  id: string;
  createdAt: string;
  // The import that created the issue, on its creation entry.
  issueImport?: { service: string } | null;
  // The acting user's id: set with a null `actor` when that user is no longer
  // visible or was removed; null for a change the system made.
  actorId?: string | null;
  actor: FeedUser | null;
  // The workflow that made the change (Linear's IssueHistory.botActor); no actor then.
  botActor?: { type?: string | null; name?: string | null } | null;
  fromStateId?: string | null;
  toStateId?: string | null;
  fromState?: Named | null;
  toState?: Named | null;
  fromAssigneeId?: string | null;
  toAssigneeId?: string | null;
  fromAssignee?: Named | null;
  toAssignee?: Named | null;
  fromDelegate?: Named | null;
  toDelegate?: Named | null;
  fromProjectId?: string | null;
  toProjectId?: string | null;
  fromProject?: Named | null;
  toProject?: Named | null;
  fromCycleId?: string | null;
  toCycleId?: string | null;
  fromCycle?: { number: number; name: string | null } | null;
  toCycle?: { number: number; name: string | null } | null;
  fromParentId?: string | null;
  toParentId?: string | null;
  fromParent?: { identifier: string } | null;
  toParent?: { identifier: string } | null;
  fromPriority?: number | null;
  toPriority?: number | null;
  fromTitle?: string | null;
  toTitle?: string | null;
  fromDueDate?: string | null;
  toDueDate?: string | null;
  updatedDescription?: boolean | null;
  addedLabelIds?: string[] | null;
  removedLabelIds?: string[] | null;
  addedLabels?: Named[] | null;
  removedLabels?: Named[] | null;
  archived?: boolean | null;
  relationChanges?: { identifier: string; type: string }[] | null;
}

// Linear's relation change codes (IssueRelationHistoryPayload.type) as the relation
// subjects the feed phrases. The first letter is a (added) or r (removed).
const RELATION_SUBJECT: Record<string, string> = {
  x: 'blocks',
  b: 'blocked_by',
  r: 'related',
  d: 'duplicate_of',
  m: 'duplicated_by',
};

// The name of a referenced item: its name when it still exists, "a removed …" when
// the history still has its id but the item is gone, and null when the entry has no
// id (written before ids were recorded and not matched since).
function refName(id: string | null | undefined, item: Named | null | undefined, kind: string) {
  if (item) return item.name;
  return id ? `a removed ${kind}` : null;
}

function cycleName(cycle: FeedHistory['fromCycle'], id: string | null | undefined) {
  if (cycle) return cycle.name || `Cycle ${cycle.number}`;
  return id ? 'a removed cycle' : null;
}

// A parent's identifier, or "an issue" when the history keeps its id but the issue
// no longer exists.
function parentName(parent: FeedHistory['fromParent'], id: string | null | undefined) {
  if (parent) return parent.identifier;
  return id ? 'an issue' : null;
}

function base(h: FeedHistory, issueId: string, suffix = ''): FeedItem {
  const actor = actorDisplay(h);
  return {
    id: h.id + suffix,
    issueId,
    kind: 'activity',
    actorUserId: h.actor?.id ?? null,
    actorName: actor.kind === 'unknown' ? (h.actorId ? REMOVED_USER : null) : actor.name,
    actorIsApp: actor.kind === 'app',
    actorWorkflow: actor.kind === 'workflow',
    body: null,
    action: null,
    subject: null,
    fromText: null,
    toText: null,
    parentId: null,
    editedAt: null,
    createdAt: h.createdAt,
  };
}

// The change rows one history entry describes, or none when it describes no change
// the feed shows.
export function historyToFeedItems(h: FeedHistory, issueId: string): FeedItem[] {
  const row = (action: FeedItem['action'], fromText: string | null, toText: string | null) => ({
    ...base(h, issueId),
    action,
    fromText,
    toText,
  });

  if (h.fromStateId || h.toStateId || h.fromState || h.toState)
    return [
      row(
        'status',
        refName(h.fromStateId, h.fromState, 'state'),
        refName(h.toStateId, h.toState, 'state'),
      ),
    ];
  if (h.fromAssigneeId || h.toAssigneeId || h.fromAssignee || h.toAssignee)
    return [
      row(
        'assignee',
        refName(h.fromAssigneeId, h.fromAssignee, 'user'),
        refName(h.toAssigneeId, h.toAssignee, 'user'),
      ),
    ];
  if (h.fromDelegate || h.toDelegate)
    return [row('delegate', h.fromDelegate?.name ?? null, h.toDelegate?.name ?? null)];
  if (h.fromProjectId || h.toProjectId || h.fromProject || h.toProject)
    return [
      row(
        'project',
        refName(h.fromProjectId, h.fromProject, 'project'),
        refName(h.toProjectId, h.toProject, 'project'),
      ),
    ];
  if (h.fromCycleId || h.toCycleId || h.fromCycle || h.toCycle)
    return [row('cycle', cycleName(h.fromCycle, h.fromCycleId), cycleName(h.toCycle, h.toCycleId))];
  if (h.fromParentId || h.toParentId || h.fromParent || h.toParent)
    return [
      row('parent', parentName(h.fromParent, h.fromParentId), parentName(h.toParent, h.toParentId)),
    ];
  if (h.fromPriority != null || h.toPriority != null)
    return [
      row(
        'priority',
        h.fromPriority == null ? null : String(h.fromPriority),
        h.toPriority == null ? null : String(h.toPriority),
      ),
    ];
  if (h.fromTitle != null || h.toTitle != null)
    return [row('title', h.fromTitle ?? null, h.toTitle ?? null)];
  if (h.fromDueDate !== undefined || h.toDueDate !== undefined) {
    if (h.fromDueDate != null || h.toDueDate != null)
      return [row('due_date', h.fromDueDate ?? null, h.toDueDate ?? null)];
  }
  if (h.updatedDescription) return [row('description', null, null)];

  const added = h.addedLabelIds ?? [];
  const removed = h.removedLabelIds ?? [];
  if (added.length || removed.length) {
    const rows: FeedItem[] = [];
    added.forEach((id, i) =>
      rows.push({
        ...base(h, issueId, `:add:${id}`),
        action: 'label_add',
        toText: h.addedLabels?.[i]?.name ?? 'a removed label',
      }),
    );
    removed.forEach((id, i) =>
      rows.push({
        ...base(h, issueId, `:remove:${id}`),
        action: 'label_remove',
        fromText: h.removedLabels?.[i]?.name ?? 'a removed label',
      }),
    );
    return rows;
  }
  if (h.archived === true) return [row('archived', null, null)];
  if (h.archived === false) return [row('restored', null, null)];

  const relations = h.relationChanges ?? [];
  if (relations.length)
    return relations.map((r, i) => {
      const added = r.type.startsWith('a');
      return {
        ...base(h, issueId, relations.length > 1 ? `:rel:${i}` : ''),
        action: 'relation' as const,
        subject: RELATION_SUBJECT[r.type.slice(1)] ?? 'related',
        fromText: added ? null : r.identifier,
        toText: added ? r.identifier : null,
      };
    });
  return [];
}

const newestFirst = (a: { createdAt: string }, b: { createdAt: string }) =>
  b.createdAt.localeCompare(a.createdAt);

// What the caller knows about the loaded pages. `issueCreatedAt` identifies the
// creation entry; `commentsHasMore` / `historyHasMore` say a connection has older
// pages that are not loaded.
export interface FeedOptions {
  issueCreatedAt?: string;
  commentsHasMore?: boolean;
  historyHasMore?: boolean;
}

// The history entry logged when the issue was created (within a second of it), when
// all history is loaded. IssueHistory has no action, so the creation entry is the one
// describing no change at the issue's creation time.
function isCreation(h: FeedHistory, opts: FeedOptions): boolean {
  if (opts.historyHasMore || !opts.issueCreatedAt) return false;
  return Math.abs(Date.parse(h.createdAt) - Date.parse(opts.issueCreatedAt)) < 1000;
}

// The time before which the merged feed is incomplete (see pagedCutoff).
export function feedCutoff(
  comments: { createdAt: string }[],
  history: { createdAt: string }[],
  opts: FeedOptions,
): string | null {
  return pagedCutoff([
    { rows: comments, hasMore: !!opts.commentsHasMore },
    { rows: history, hasMore: !!opts.historyHasMore },
  ]);
}

export function buildFeed(
  comments: FeedComment[],
  history: FeedHistory[],
  issueId: string,
  opts: FeedOptions = {},
): FeedEntry[] {
  const entries = buildThreads(comments, issueId);

  // History: the entries that describe a change, and the creation entry.
  for (const h of history) {
    const rows = historyToFeedItems(h, issueId);
    if (rows.length === 0 && isCreation(h, opts))
      rows.push(
        h.issueImport
          ? {
              ...base(h, issueId),
              action: 'imported',
              toText: importSourceLabel(h.issueImport.service),
            }
          : { ...base(h, issueId), action: 'created' },
      );
    for (const item of rows) entries.push({ item, replies: [], resolved: false });
  }

  const cutoff = feedCutoff(comments, history, opts);
  return entries
    .filter((e) => cutoff === null || e.item.createdAt >= cutoff)
    .sort((a, b) => newestFirst(a.item, b.item));
}

// The source of an imported issue as its activity names it ("imported the issue from
// Gitea"); an unknown service is shown as stored.
const IMPORT_SOURCES: Record<string, string> = {
  github: 'GitHub',
  gitlab: 'GitLab',
  gitea: 'Gitea',
  forgejo: 'Forgejo',
};

export function importSourceLabel(service: string): string {
  return IMPORT_SOURCES[service] ?? service;
}
