import { actorDisplay } from '@/utils/actorDisplay';
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
  // The agent session a thread belongs to (Linear's Comment.agentSession).
  agentSession?: { id: string } | null;
  user: FeedUser | null;
  // The workflow that wrote the comment (Linear's Comment.botActor); no user then.
  botActor?: { type?: string | null; name?: string | null } | null;
  // The portal visitor who wrote it (Linear's Comment.externalUser; null for guests).
  externalUser?: { name: string } | null;
  // Set on the root of a portal thread (type "portal").
  externalThread?: { type: string; name?: string | null; url?: string | null } | null;
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

const isPortalThread = (c: FeedComment) => c.externalThread?.type === 'portal';

// `ownerId` fills FeedItem.issueId: the id of the issue, document, project or
// update the comment belongs to. `inPortalThread` marks a comment of a portal thread,
// where a comment without a member author is a visitor's.
export function commentToFeedItem(
  c: FeedComment,
  ownerId: string,
  inPortalThread = isPortalThread(c),
): FeedItem {
  const author = actorDisplay({
    actor: c.user,
    botActor: c.botActor,
    externalUser: c.externalUser,
    portal: inPortalThread,
  });
  return {
    id: c.id,
    issueId: ownerId,
    kind: 'comment',
    actorUserId: c.user?.id ?? null,
    // Every comment has an author; a missing one was removed or is hidden.
    actorName: author.kind === 'unknown' ? REMOVED_USER : author.name,
    actorIsApp: author.kind === 'app',
    actorWorkflow: author.kind === 'workflow',
    actorPortal: author.kind === 'visitor',
    portalBoard: isPortalThread(c) ? (c.externalThread?.name ?? null) : null,
    body: c.body,
    action: null,
    subject: null,
    fromText: null,
    toText: null,
    parentId: c.parentId,
    agentSessionId: c.agentSession?.id ?? null,
    editedAt: c.editedAt,
    createdAt: c.createdAt,
    reactions: c.reactions ?? [],
  };
}

// The threads of a comment list, in the order the roots came; replies oldest first.
export function buildThreads(comments: FeedComment[], ownerId: string): FeedEntry[] {
  const entries: FeedEntry[] = [];
  const roots = new Map<string, FeedEntry>();
  const portalRoots = new Set<string>();
  for (const c of comments) {
    if (c.parentId) continue;
    if (isPortalThread(c)) portalRoots.add(c.id);
    const entry = { item: commentToFeedItem(c, ownerId), replies: [], resolved: !!c.resolvedAt };
    roots.set(c.id, entry);
    entries.push(entry);
  }
  for (const c of [...comments].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    if (!c.parentId) continue;
    const root = roots.get(c.parentId);
    const reply = commentToFeedItem(c, ownerId, portalRoots.has(c.parentId));
    if (root) root.replies.push(reply);
    else entries.push({ item: reply, replies: [], resolved: false });
  }
  return entries;
}

// The threads newest first, as comment lists show them.
export const buildThreadsNewestFirst = (comments: FeedComment[], ownerId: string) =>
  buildThreads(comments, ownerId).sort((a, b) => b.item.createdAt.localeCompare(a.item.createdAt));
