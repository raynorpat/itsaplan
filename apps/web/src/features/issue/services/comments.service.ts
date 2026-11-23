// Issue feed (comments + history), the status timeline and comment writes, over
// GraphQL. The feed is the issue's comments and Linear's IssueHistory merged into
// threads by buildFeed; the timeline is the issue's state spans.

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FeedItem, type TimelineSegment } from '@/lib/api';
import { graphql, gqlRequest } from '@/lib/graphql';
import { qk } from '@/services/queryKeys';
import { buildFeed, type FeedComment, type FeedEntry, type FeedHistory } from '../utils/feed';
import { commentTargetInput, commentTargetKey, type CommentTarget } from '../utils/commentTarget';

// Comments and history entries per page. "Show older" loads the next page of each
// connection that has more.
const FEED_PAGE = 100;

const FeedCommentsQuery = graphql(`
  query IssueFeedComments($id: String!, $first: Int!, $after: String) {
    issue(id: $id) {
      id
      createdAt
      comments(first: $first, after: $after) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          id
          body
          createdAt
          editedAt
          resolvedAt
          parentId
          user {
            id
            name
          }
          reactions {
            id
            emoji
            user {
              id
              name
            }
          }
        }
      }
    }
  }
`);

const FeedHistoryQuery = graphql(`
  query IssueFeedHistory($id: String!, $first: Int!, $after: String) {
    issue(id: $id) {
      id
      createdAt
      history(first: $first, after: $after) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          id
          createdAt
          actorId
          actor {
            id
            name
          }
          fromStateId
          toStateId
          fromState {
            name
          }
          toState {
            name
          }
          fromAssigneeId
          toAssigneeId
          fromAssignee {
            name
          }
          toAssignee {
            name
          }
          fromDelegate {
            name
          }
          toDelegate {
            name
          }
          fromProjectId
          toProjectId
          fromProject {
            name
          }
          toProject {
            name
          }
          fromCycleId
          toCycleId
          fromCycle {
            number
            name
          }
          toCycle {
            number
            name
          }
          fromPriority
          toPriority
          fromTitle
          toTitle
          fromDueDate
          toDueDate
          updatedDescription
          addedLabelIds
          removedLabelIds
          addedLabels {
            name
          }
          removedLabels {
            name
          }
          archived
          relationChanges {
            identifier
            type
          }
        }
      }
    }
  }
`);

const TimelineQuery = graphql(`
  query IssueStateHistory($id: String!) {
    issue(id: $id) {
      id
      stateHistory(first: 250) {
        nodes {
          id
          startedAt
          endedAt
          state {
            name
          }
        }
      }
    }
  }
`);

const CommentCreate = graphql(`
  mutation IssueCommentCreate($input: CommentCreateInput!) {
    commentCreate(input: $input) {
      success
    }
  }
`);

const CommentUpdate = graphql(`
  mutation IssueCommentUpdate($id: String!, $input: CommentUpdateInput!) {
    commentUpdate(id: $id, input: $input) {
      success
    }
  }
`);

const CommentDelete = graphql(`
  mutation IssueCommentDelete($id: String!) {
    commentDelete(id: $id) {
      success
    }
  }
`);

const CommentResolve = graphql(`
  mutation IssueCommentResolve($id: String!) {
    commentResolve(id: $id) {
      success
    }
  }
`);

const CommentUnresolve = graphql(`
  mutation IssueCommentUnresolve($id: String!) {
    commentUnresolve(id: $id) {
      success
    }
  }
`);

// Where each connection's next page starts: a cursor, null for the first page, or
// false when the connection has no more pages.
interface FeedCursors {
  comments: string | null | false;
  history: string | null | false;
}

interface FeedPage {
  issueId: string;
  issueCreatedAt: string;
  comments: FeedComment[];
  history: FeedHistory[];
  next: FeedCursors;
}

async function fetchFeedPage(id: string, cursors: FeedCursors): Promise<FeedPage> {
  const [c, h] = await Promise.all([
    cursors.comments === false
      ? null
      : gqlRequest(FeedCommentsQuery, { id, first: FEED_PAGE, after: cursors.comments }),
    cursors.history === false
      ? null
      : gqlRequest(FeedHistoryQuery, { id, first: FEED_PAGE, after: cursors.history }),
  ]);
  const issue = (c?.issue ?? h?.issue)!;
  const more = (info?: { hasNextPage: boolean; endCursor?: string | null } | null) =>
    info?.hasNextPage && info.endCursor ? info.endCursor : false;
  return {
    issueId: issue.id,
    issueCreatedAt: issue.createdAt,
    comments: c?.issue.comments.nodes ?? [],
    history: h?.issue.history.nodes ?? [],
    next: {
      comments: more(c?.issue.comments.pageInfo),
      history: more(h?.issue.history.pageInfo),
    },
  };
}

// What the issue page reads from the feed: the entries built from every loaded page,
// newest first, and loading of older pages.
export interface FeedQueryResult {
  data: FeedEntry[] | undefined;
  isPending: boolean;
  isLoading: boolean;
  isError: boolean;
  hasOlder: boolean;
  loadingOlder: boolean;
  loadOlder: () => void;
}

// The issue's feed, newest first, threads grouped. Pages of comments and of history
// load together; the feed stops where a connection still has older entries (see
// feedCutoff), so it never shows a stretch with only one kind of entry.
export function useFeedQuery(id: string): FeedQueryResult {
  const query = useInfiniteQuery({
    queryKey: qk.feed(id),
    initialPageParam: { comments: null, history: null } as FeedCursors,
    queryFn: ({ pageParam }) => fetchFeedPage(id, pageParam),
    getNextPageParam: (last) =>
      last.next.comments === false && last.next.history === false ? undefined : last.next,
  });
  const pages = query.data?.pages;
  const data = pages
    ? (() => {
        const last = pages[pages.length - 1]!;
        return buildFeed(
          pages.flatMap((p) => p.comments),
          pages.flatMap((p) => p.history),
          last.issueId,
          {
            issueCreatedAt: last.issueCreatedAt,
            commentsHasMore: last.next.comments !== false,
            historyHasMore: last.next.history !== false,
          },
        );
      })()
    : undefined;
  return {
    data,
    isPending: query.isPending,
    isLoading: query.isLoading,
    isError: query.isError,
    hasOlder: query.hasNextPage,
    loadingOlder: query.isFetchingNextPage,
    loadOlder: () => void query.fetchNextPage(),
  };
}

// The stretches the issue spent in one status, oldest first.
export function useTimelineQuery(id: string) {
  return useQuery({
    queryKey: qk.timeline(id),
    queryFn: async (): Promise<TimelineSegment[]> => {
      const { issue } = await gqlRequest(TimelineQuery, { id });
      const now = Date.now();
      return issue.stateHistory.nodes.map((span) => {
        const to = span.endedAt ?? null;
        return {
          status: span.state?.name ?? null,
          from: span.startedAt,
          to,
          durationMs: (to ? Date.parse(to) : now) - Date.parse(span.startedAt),
        };
      });
    },
  });
}

// One time range of the issue's activity, as the timeline addresses its stretches.
export interface TimelineRange {
  from: string;
  to: string | null;
}

// The feed entries written inside the given stretches, oldest first. A status may
// have been visited more than once, so a lane's popover asks for several ranges.
// Filtered from the loaded feed (history has no time filter of its own);
// `olderNotLoaded` says a range reaches before the oldest loaded entry.
export function useTimelineItemsQuery(issueId: string, ranges: TimelineRange[]) {
  const feed = useFeedQuery(issueId);
  const loaded = (feed.data ?? []).map((e) => e.item.createdAt).sort()[0];
  const olderNotLoaded =
    feed.hasOlder && ranges.some((r) => loaded !== undefined && r.from < loaded);
  const inRange = (item: FeedItem) =>
    ranges.some((r) => item.createdAt >= r.from && (r.to == null || item.createdAt < r.to));
  const items = (feed.data ?? [])
    .flatMap((entry) => [entry.item, ...entry.replies])
    .filter(inRange)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return { isPending: feed.isPending, isError: feed.isError, items, olderNotLoaded };
}

// A new comment on an issue or a document, or a reply when parentId is set (the API
// stores a reply to a reply under the thread's root).
export function useCreateComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      target,
      input,
    }: {
      target: CommentTarget;
      input: { body: string; parentId?: string | null };
    }) =>
      gqlRequest(CommentCreate, {
        input: {
          ...commentTargetInput(target),
          body: input.body,
          parentId: input.parentId ?? undefined,
        },
      }),
    onSuccess: (_data, { target }) => {
      void qc.invalidateQueries({ queryKey: commentTargetKey(target) });
      // Commenting on an issue subscribes the author (server side).
      if ('issueId' in target)
        void qc.invalidateQueries({ queryKey: qk.issueSubscribers(target.issueId) });
    },
  });
}

// Edit, delete, resolve and unresolve a comment of an issue or a document. Each
// refreshes the target's comments once it lands.
function useTargetCommentMutation<V extends { target: CommentTarget }>(
  run: (vars: V) => Promise<unknown>,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSettled: (_data, _error, { target }) =>
      void qc.invalidateQueries({ queryKey: commentTargetKey(target) }),
  });
}

export function useUpdateComment() {
  return useTargetCommentMutation(
    ({ id, body }: { target: CommentTarget; id: string; body: string }) =>
      gqlRequest(CommentUpdate, { id, input: { body } }),
  );
}

export function useDeleteComment() {
  return useTargetCommentMutation(({ id }: { target: CommentTarget; id: string }) =>
    gqlRequest(CommentDelete, { id }),
  );
}

export function useSetThreadResolved() {
  return useTargetCommentMutation(
    ({ id, resolved }: { target: CommentTarget; id: string; resolved: boolean }) =>
      resolved ? gqlRequest(CommentResolve, { id }) : gqlRequest(CommentUnresolve, { id }),
  );
}
