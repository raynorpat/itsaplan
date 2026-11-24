import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
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
        createdAt
        updatedAt
        completedAt
        canceledAt
        dueDate
        parent {
          id
        }
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
        delegate {
          name
          avatarUrl
        }
        labels {
          nodes {
            id
            name
            color
          }
        }
        project {
          id
          name
          archivedAt
        }
        cycle {
          number
          name
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`);

type Person = { name: string; avatarUrl: string | null };

export type MyIssue = {
  id: string;
  identifier: string;
  number: number;
  title: string;
  priority: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  canceledAt: string | null;
  parentId: string | null;
  dueDate: string | null;
  teamKey: string;
  state: { name: string; type: string; color: string };
  assignee: Person | null;
  delegate: Person | null;
  labels: { id: string; name: string; color: string }[];
  project: { id: string; name: string; archivedAt?: string | null } | null;
  cycle: { number: number; name: string | null } | null;
};

// Issues per page: 50 when paging on request, the API's 250 when the whole set is
// loaded (myIssuesLoadMode).
const PAGE_SIZE = { paged: 50, all: 250 } as const;

type NodePerson = { name: string; avatarUrl?: string | null } | null;

type MyIssueNode = {
  id: string;
  identifier: string;
  number: number;
  title: string;
  priority: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
  canceledAt?: string | null;
  parent?: { id: string } | null;
  dueDate?: string | null;
  team: { key: string };
  state: { name: string; type: string; color: string };
  assignee: NodePerson;
  delegate?: NodePerson;
  labels: { nodes: { id: string; name: string; color: string }[] };
  project?: { id: string; name: string; archivedAt?: string | null } | null;
  cycle?: { number: number; name?: string | null } | null;
};

const person = (p: NodePerson | undefined): Person | null =>
  p ? { name: p.name, avatarUrl: p.avatarUrl ?? null } : null;

function toMyIssue(n: MyIssueNode): MyIssue {
  return {
    id: n.id,
    identifier: n.identifier,
    number: n.number,
    title: n.title,
    priority: n.priority,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
    completedAt: n.completedAt ?? null,
    canceledAt: n.canceledAt ?? null,
    parentId: n.parent?.id ?? null,
    dueDate: n.dueDate ?? null,
    teamKey: n.team.key,
    state: n.state,
    assignee: person(n.assignee),
    delegate: person(n.delegate),
    labels: n.labels.nodes,
    project: n.project ?? null,
    cycle: n.cycle ? { number: n.cycle.number, name: n.cycle.name ?? null } : null,
  };
}

// The viewer's issues for one tab across every team they can see, newest change
// first, a page at a time. Registered in qk so every issue write refreshes it
// (ISSUE_DEPENDENT_KEYS). The previous issues stay shown while a changed display
// loads a different set.
export function useMyIssues(tab: MyIssuesTab, includeCompleted: boolean, mode: 'paged' | 'all') {
  const query = useInfiniteQuery({
    queryKey: qk.myIssues(tab, includeCompleted, mode),
    queryFn: async ({ pageParam }) => {
      const data = await gqlRequest(MyIssuesPage, {
        filter: myIssuesFilter(tab, includeCompleted),
        after: pageParam,
        first: PAGE_SIZE[mode],
      });
      return data.issues;
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.pageInfo.hasNextPage ? last.pageInfo.endCursor : null),
    placeholderData: keepPreviousData,
  });
  const issues = (query.data?.pages ?? []).flatMap((p) => p.nodes.map(toMyIssue));
  return { ...query, issues };
}
