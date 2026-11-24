import { useQuery } from '@tanstack/react-query';
import { gqlRequest, graphql } from '@/lib/graphql';
import { fetchAllPages } from '@/utils/fetchAllPages';
import { myIssuesFilter, type MyIssuesTab } from '../utils/myIssues';

const MyIssuesPage = graphql(`
  query MyIssues($filter: IssueFilter, $after: String, $first: Int) {
    issues(filter: $filter, first: $first, after: $after) {
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

async function fetchMyIssues(tab: MyIssuesTab): Promise<MyIssue[]> {
  const nodes = await fetchAllPages(async (after, first) => {
    const data = await gqlRequest(MyIssuesPage, { filter: myIssuesFilter(tab), after, first });
    return data.issues;
  });
  return nodes
    .map((n) => ({
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
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

// The viewer's issues for one tab, across every team they can see.
export function useMyIssues(tab: MyIssuesTab) {
  return useQuery({ queryKey: ['myIssues', tab], queryFn: () => fetchMyIssues(tab) });
}
