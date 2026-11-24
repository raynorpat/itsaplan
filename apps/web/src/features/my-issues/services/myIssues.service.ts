import { useInfiniteQuery } from '@tanstack/react-query';
import { gqlRequest, graphql } from '@/lib/graphql';
import { qk } from '@/services/queryKeys';
import { myIssuesFilter, type MyIssuesTab } from '../utils/myIssues';

const MyIssuesPage = graphql(`
  query MyIssues($filter: IssueFilter, $after: String, $first: Int) {
    issues(filter: $filter, first: $first, after: $after, orderBy: updatedAt) {
      nodes {
        id
        identifier
        number
        title
        priority
        updatedAt
        team {
          key
        }
        state {
          name
          type
          color
        }
        assignee {
          name
          avatarUrl
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`);

export type MyIssue = {
  id: string;
  identifier: string;
  number: number;
  title: string;
  priority: number;
  updatedAt: string;
  teamKey: string;
  state: { name: string; type: string; color: string };
  assignee: { name: string; avatarUrl: string | null } | null;
};

// Issues per page; more load on request.
const PAGE_SIZE = 50;

type MyIssueNode = {
  id: string;
  identifier: string;
  number: number;
  title: string;
  priority: number;
  updatedAt: string;
  team: { key: string };
  state: { name: string; type: string; color: string };
  assignee: { name: string; avatarUrl?: string | null } | null;
};

function toMyIssue(n: MyIssueNode): MyIssue {
  return {
    id: n.id,
    identifier: n.identifier,
    number: n.number,
    title: n.title,
    priority: n.priority,
    updatedAt: n.updatedAt,
    teamKey: n.team.key,
    state: n.state,
    assignee: n.assignee
      ? { name: n.assignee.name, avatarUrl: n.assignee.avatarUrl ?? null }
      : null,
  };
}

// The viewer's issues for one tab across every team they can see, newest change
// first, one page at a time. Registered in qk so every issue write refreshes it
// (ISSUE_DEPENDENT_KEYS).
export function useMyIssues(tab: MyIssuesTab, includeCompleted: boolean) {
  const query = useInfiniteQuery({
    queryKey: qk.myIssues(tab, includeCompleted),
    queryFn: async ({ pageParam }) => {
      const data = await gqlRequest(MyIssuesPage, {
        filter: myIssuesFilter(tab, includeCompleted),
        after: pageParam,
        first: PAGE_SIZE,
      });
      return data.issues;
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.pageInfo.hasNextPage ? last.pageInfo.endCursor : null),
  });
  const issues = (query.data?.pages ?? []).flatMap((p) => p.nodes.map(toMyIssue));
  return { ...query, issues };
}
