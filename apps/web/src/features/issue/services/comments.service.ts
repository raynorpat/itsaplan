// Issue feed (comments + history), the status timeline and comment writes, over
// GraphQL. The feed is the issue's comments and Linear's IssueHistory merged into
// threads by buildFeed; the timeline is the issue's state spans.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FeedItem, type TimelineSegment } from '@/lib/api';
import { graphql, gqlRequest } from '@/lib/graphql';
import { qk } from '@/services/queryKeys';
import { buildFeed, type FeedEntry } from '@/utils/feed';

// The most recent comments and history entries loaded with the issue. Connections
// cap a page at 250.
const FEED_PAGE = 250;

const FeedQuery = graphql(`
  query IssueFeed($id: String!, $first: Int!) {
    issue(id: $id) {
      id
      comments(first: $first) {
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
        }
      }
      history(first: $first) {
        nodes {
          id
          createdAt
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

// The issue's feed, newest first, threads grouped.
export function useFeedQuery(id: string) {
  return useQuery({
    queryKey: qk.feed(id),
    queryFn: async (): Promise<FeedEntry[]> => {
      const { issue } = await gqlRequest(FeedQuery, { id, first: FEED_PAGE });
      return buildFeed(issue.comments.nodes, issue.history.nodes, issue.id);
    },
  });
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
// Filtered from the loaded feed: history has no time filter of its own.
export function useTimelineItemsQuery(issueId: string, ranges: TimelineRange[]) {
  const feed = useFeedQuery(issueId);
  const inRange = (item: FeedItem) =>
    ranges.some((r) => item.createdAt >= r.from && (r.to == null || item.createdAt < r.to));
  const items = (feed.data ?? [])
    .flatMap((entry) => [entry.item, ...entry.replies])
    .filter(inRange)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return { isPending: feed.isPending, isError: feed.isError, items };
}

export function useCreateComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ issueId, input }: { issueId: string; input: { body: string } }) =>
      gqlRequest(CommentCreate, { input: { issueId, body: input.body } }),
    onSuccess: (_data, { issueId }) => void qc.invalidateQueries({ queryKey: qk.feed(issueId) }),
  });
}
