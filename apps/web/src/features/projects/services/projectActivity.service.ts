// The project's activity on the overview over GraphQL: its history, its comments and
// its updates, each connection paged newest first and merged by buildProjectFeed.
// "Show older" loads the next page of every connection that has more.

import { useInfiniteQuery } from '@tanstack/react-query';
import type { ProjectHealth } from '@/types/project';
import { graphql, gqlRequest } from '@/lib/graphql';
import { qk } from '@/services/queryKeys';
import { buildProjectFeed, type ProjectFeedEntry } from '../utils/projectFeed';

const PAGE = 50;

const HistoryQuery = graphql(`
  query ProjectActivityHistory($id: String!, $first: Int!, $after: String) {
    project(id: $id) {
      history(first: $first, after: $after) {
        nodes {
          id
          createdAt
          entries
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
`);

const CommentsQuery = graphql(`
  query ProjectActivityComments($id: String!, $first: Int!, $after: String) {
    project(id: $id) {
      comments(first: $first, after: $after) {
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
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
`);

const UpdatesQuery = graphql(`
  query ProjectActivityUpdates($id: String!, $first: Int!, $after: String) {
    project(id: $id) {
      projectUpdates(first: $first, after: $after) {
        nodes {
          id
          createdAt
          health
          body
          user {
            id
            name
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
`);

// Where each connection's next page starts: a cursor, null for the first page, or
// false when it has no more pages.
interface Cursors {
  history: string | null | false;
  comments: string | null | false;
  updates: string | null | false;
}

type Info = { hasNextPage: boolean; endCursor?: string | null };
const more = (info?: Info) => (info?.hasNextPage && info.endCursor ? info.endCursor : false);

async function fetchPage(id: string, cursors: Cursors) {
  const page = <T>(cursor: string | null | false, run: (after: string | null) => Promise<T>) =>
    cursor === false ? Promise.resolve(null) : run(cursor);
  const [h, c, u] = await Promise.all([
    page(cursors.history, (after) => gqlRequest(HistoryQuery, { id, first: PAGE, after })),
    page(cursors.comments, (after) => gqlRequest(CommentsQuery, { id, first: PAGE, after })),
    page(cursors.updates, (after) => gqlRequest(UpdatesQuery, { id, first: PAGE, after })),
  ]);
  return {
    history: h?.project.history.nodes ?? [],
    comments: c?.project.comments.nodes ?? [],
    updates: (u?.project.projectUpdates.nodes ?? []).map((n) => ({
      ...n,
      health: n.health as ProjectHealth,
    })),
    next: {
      history: more(h?.project.history.pageInfo),
      comments: more(c?.project.comments.pageInfo),
      updates: more(u?.project.projectUpdates.pageInfo),
    } as Cursors,
  };
}

export function useProjectActivityQuery(projectId: string) {
  const query = useInfiniteQuery({
    queryKey: qk.projectActivity(projectId),
    initialPageParam: { history: null, comments: null, updates: null } as Cursors,
    queryFn: ({ pageParam }) => fetchPage(projectId, pageParam),
    getNextPageParam: (last) =>
      Object.values(last.next).every((c) => c === false) ? undefined : last.next,
  });
  const pages = query.data?.pages;
  const last = pages?.at(-1);
  const data: ProjectFeedEntry[] | undefined =
    pages && last
      ? buildProjectFeed(
          pages.flatMap((p) => p.history),
          pages.flatMap((p) => p.comments),
          pages.flatMap((p) => p.updates),
          projectId,
          {
            historyHasMore: last.next.history !== false,
            commentsHasMore: last.next.comments !== false,
            updatesHasMore: last.next.updates !== false,
          },
        )
      : undefined;
  return {
    data,
    isLoading: query.isLoading,
    hasOlder: query.hasNextPage,
    loadingOlder: query.isFetchingNextPage,
    loadOlder: () => void query.fetchNextPage(),
  };
}
