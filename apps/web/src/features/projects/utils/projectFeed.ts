import { type ProjectHealth } from '@/lib/api';
import {
  buildThreads,
  REMOVED_USER,
  type FeedComment,
  type FeedEntry,
  type FeedUser,
} from '@/utils/commentThreads';
import { pagedCutoff } from '@/utils/pagedCutoff';

// The project's activity on the overview: its history (Project.history), its comment
// threads and its updates, newest first. Linked issues' activity stays on each issue.

// A ProjectHistory node; `entries` is the change it records.
export interface ProjectHistoryNode {
  id: string;
  createdAt: string;
  entries: {
    action?: string | null;
    subject?: string | null;
    from?: string | null;
    to?: string | null;
    actorId?: string | null;
    actorName?: string | null;
  };
}

export interface ProjectUpdateNode {
  id: string;
  createdAt: string;
  health: ProjectHealth;
  body: string;
  user: FeedUser | null;
}

export type ProjectFeedEntry =
  | {
      kind: 'history';
      id: string;
      createdAt: string;
      // null for a change the system made.
      actorName: string | null;
      action: string;
      subject: string | null;
      from: string | null;
      to: string | null;
    }
  | { kind: 'comment'; id: string; createdAt: string; thread: FeedEntry }
  | { kind: 'update'; id: string; createdAt: string; update: ProjectUpdateNode };

// Which connections still have older pages; the feed stops at their cut
// (pagedCutoff) so it never shows a stretch missing one kind of entry.
export interface ProjectFeedOptions {
  historyHasMore?: boolean;
  commentsHasMore?: boolean;
  updatesHasMore?: boolean;
}

export function buildProjectFeed(
  history: ProjectHistoryNode[],
  comments: FeedComment[],
  updates: ProjectUpdateNode[],
  projectId = '',
  opts: ProjectFeedOptions = {},
): ProjectFeedEntry[] {
  const entries: ProjectFeedEntry[] = [];
  for (const h of history) {
    const e = h.entries;
    if (!e.action) continue;
    entries.push({
      kind: 'history',
      id: h.id,
      createdAt: h.createdAt,
      actorName: e.actorName ?? (e.actorId ? REMOVED_USER : null),
      action: e.action,
      subject: e.subject ?? null,
      from: e.from ?? null,
      to: e.to ?? null,
    });
  }
  for (const thread of buildThreads(comments, projectId))
    entries.push({
      kind: 'comment',
      id: thread.item.id,
      createdAt: thread.item.createdAt,
      thread,
    });
  for (const update of updates)
    entries.push({ kind: 'update', id: update.id, createdAt: update.createdAt, update });
  const cutoff = pagedCutoff([
    { rows: history, hasMore: !!opts.historyHasMore },
    { rows: comments, hasMore: !!opts.commentsHasMore },
    { rows: updates, hasMore: !!opts.updatesHasMore },
  ]);
  return entries
    .filter((e) => cutoff === null || e.createdAt >= cutoff)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
