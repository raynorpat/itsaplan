import { type FeedItem } from '@/lib/api';

// The issue feed built from Linear's GraphQL: the issue's comments and its history
// (IssueHistory) as feed rows, newest first. A history entry becomes one or more
// change rows in the same shape the REST feed used (action + from/to text), so the
// feed's renderers describe both the same way. Comments are grouped into threads:
// replies sit under their root, oldest first.

export interface FeedUser {
  id: string;
  name: string;
}

export interface FeedComment {
  id: string;
  body: string;
  createdAt: string;
  editedAt: string | null;
  resolvedAt: string | null;
  parentId: string | null;
  user: FeedUser | null;
  reactions?: { id: string; emoji: string; user: FeedUser | null }[];
}

interface Named {
  name: string;
}

// The IssueHistory fields the feed reads. A field the entry does not describe is
// absent or null.
export interface FeedHistory {
  id: string;
  createdAt: string;
  actor: FeedUser | null;
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

// One feed row with its thread: `replies` are the comments under a root comment,
// oldest first; `resolved` marks a resolved thread, which the feed shows collapsed.
export interface FeedEntry {
  item: FeedItem;
  replies: FeedItem[];
  resolved: boolean;
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

function base(h: FeedHistory, issueId: string, suffix = ''): FeedItem {
  return {
    id: h.id + suffix,
    issueId,
    kind: 'activity',
    actorUserId: h.actor?.id ?? null,
    actorName: h.actor?.name ?? null,
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

export function commentToFeedItem(c: FeedComment, issueId: string): FeedItem {
  return {
    id: c.id,
    issueId,
    kind: 'comment',
    actorUserId: c.user?.id ?? null,
    actorName: c.user?.name ?? null,
    body: c.body,
    action: null,
    subject: null,
    fromText: null,
    toText: null,
    parentId: c.parentId,
    editedAt: c.editedAt,
    createdAt: c.createdAt,
    reactions: c.reactions ?? [],
  };
}

const newestFirst = (a: { createdAt: string }, b: { createdAt: string }) =>
  b.createdAt.localeCompare(a.createdAt);

export function buildFeed(
  comments: FeedComment[],
  history: FeedHistory[],
  issueId: string,
): FeedEntry[] {
  const entries: FeedEntry[] = [];

  // Threads: a root comment with its replies. A reply whose root is not loaded is
  // shown on its own rather than dropped.
  const roots = new Map<string, FeedEntry>();
  for (const c of comments) {
    if (c.parentId) continue;
    const entry = { item: commentToFeedItem(c, issueId), replies: [], resolved: !!c.resolvedAt };
    roots.set(c.id, entry);
    entries.push(entry);
  }
  for (const c of [...comments].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    if (!c.parentId) continue;
    const reply = commentToFeedItem(c, issueId);
    const root = roots.get(c.parentId);
    if (root) root.replies.push(reply);
    else entries.push({ item: reply, replies: [], resolved: false });
  }

  // History: the entries that describe a change; the oldest entry that describes
  // none is the issue's creation (IssueHistory has no action of its own).
  const oldest = [...history].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  for (const h of history) {
    const rows = historyToFeedItems(h, issueId);
    if (rows.length === 0 && h === oldest) rows.push({ ...base(h, issueId), action: 'created' });
    for (const item of rows) entries.push({ item, replies: [], resolved: false });
  }

  return entries.sort((a, b) => newestFirst(a.item, b.item));
}
