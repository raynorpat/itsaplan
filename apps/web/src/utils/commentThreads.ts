import type { FeedItem } from '@/types/issue';

// Comment threads built from Linear's GraphQL comments, for every comment list (an
// issue's feed, a document's, a project's, a project update's): a root comment with
// its replies under it, oldest first. A reply whose root is not loaded is shown on
// its own rather than dropped.

export interface FeedUser {
  id: string;
  name: string;
  // An app user (an OAuth application installed with actor=app).
  app?: boolean;
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

// One feed row with its thread: `replies` are the comments under a root comment,
// oldest first; `resolved` marks a resolved thread, which the list shows collapsed.
export interface FeedEntry {
  item: FeedItem;
  replies: FeedItem[];
  resolved: boolean;
}

export const REMOVED_USER = 'a removed user';

// `ownerId` fills FeedItem.issueId: the id of the issue, document, project or
// update the comment belongs to.
export function commentToFeedItem(c: FeedComment, ownerId: string): FeedItem {
  return {
    id: c.id,
    issueId: ownerId,
    kind: 'comment',
    actorUserId: c.user?.id ?? null,
    // Every comment has an author; a missing one was removed or is hidden.
    actorName: c.user?.name ?? REMOVED_USER,
    actorIsApp: c.user?.app ?? false,
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

// The threads of a comment list, in the order the roots came; replies oldest first.
export function buildThreads(comments: FeedComment[], ownerId: string): FeedEntry[] {
  const entries: FeedEntry[] = [];
  const roots = new Map<string, FeedEntry>();
  for (const c of comments) {
    if (c.parentId) continue;
    const entry = { item: commentToFeedItem(c, ownerId), replies: [], resolved: !!c.resolvedAt };
    roots.set(c.id, entry);
    entries.push(entry);
  }
  for (const c of [...comments].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    if (!c.parentId) continue;
    const reply = commentToFeedItem(c, ownerId);
    const root = roots.get(c.parentId);
    if (root) root.replies.push(reply);
    else entries.push({ item: reply, replies: [], resolved: false });
  }
  return entries;
}

// The threads newest first, as comment lists show them.
export const buildThreadsNewestFirst = (comments: FeedComment[], ownerId: string) =>
  buildThreads(comments, ownerId).sort((a, b) => b.item.createdAt.localeCompare(a.item.createdAt));
