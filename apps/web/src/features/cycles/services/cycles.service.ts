import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Issue } from '@/lib/api';
import { graphql, gqlRequest, readFragment, type FragmentOf } from '@/lib/graphql';
import { IssueFields, toIssue } from '@/services/issues.service';
import { qk } from '@/services/queryKeys';
import { fetchAllPages } from '@/utils/fetchAllPages';
import { mergeCyclePages, type CycleHistories } from '../utils/cyclePage';

// A cycle as the cycles page lists it.
export interface CycleListItem {
  id: string;
  number: number;
  name: string | null;
  startsAt: string;
  endsAt: string;
  completedAt: string | null;
  progress: number;
}

// A cycle as its own page shows it: the list fields, its description and the daily
// histories the chart draws.
export interface CycleSummary extends CycleListItem, CycleHistories {
  description: string | null;
}

const CycleListFields = graphql(`
  fragment CycleListFields on Cycle {
    id
    number
    name
    startsAt
    endsAt
    completedAt
    progress
  }
`);

const CycleFields = graphql(
  `
    fragment CycleFields on Cycle {
      ...CycleListFields
      description
      scopeHistory
      inProgressScopeHistory
      completedScopeHistory
    }
  `,
  [CycleListFields],
);

const CyclesQuery = graphql(
  `
    query TeamCycles($filter: CycleFilter, $first: Int!, $after: String) {
      cycles(filter: $filter, first: $first, after: $after) {
        nodes {
          ...CycleListFields
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  `,
  [CycleListFields],
);

const CycleByNumberQuery = graphql(
  `
    query TeamCycleByNumber($filter: CycleFilter) {
      cycles(filter: $filter, first: 1) {
        nodes {
          ...CycleFields
        }
      }
    }
  `,
  [CycleFields],
);

function toCycleListItem(data: FragmentOf<typeof CycleListFields>): CycleListItem {
  const node = readFragment(CycleListFields, data);
  return {
    id: node.id,
    number: node.number,
    name: node.name ?? null,
    startsAt: String(node.startsAt),
    endsAt: String(node.endsAt),
    completedAt: node.completedAt ? String(node.completedAt) : null,
    progress: node.progress,
  };
}

function toCycleSummary(data: FragmentOf<typeof CycleFields>): CycleSummary {
  const node = readFragment(CycleFields, data);
  return {
    ...toCycleListItem(node),
    description: node.description ?? null,
    scopeHistory: node.scopeHistory,
    inProgressScopeHistory: node.inProgressScopeHistory,
    completedScopeHistory: node.completedScopeHistory,
  };
}

const teamFilter = (teamId: string) => ({ team: { id: { eq: teamId } } });

async function fetchCycles(filter: Record<string, unknown>, first: number, after: string | null) {
  const data = await gqlRequest(CyclesQuery, { filter, first, after });
  return {
    items: data.cycles.nodes.map(toCycleListItem),
    endCursor: data.cycles.pageInfo.hasNextPage ? (data.cycles.pageInfo.endCursor ?? null) : null,
  };
}

// The team's current and upcoming cycles (the API keeps at most 10 upcoming).
export function useOpenCycles(teamId: string | null) {
  return useQuery({
    queryKey: qk.cycles(teamId ?? '', 'open'),
    queryFn: async () =>
      (await fetchCycles({ ...teamFilter(teamId!), isPast: { eq: false } }, 50, null)).items,
    enabled: teamId != null,
  });
}

const PAST_PAGE_SIZE = 25;

// The team's past cycles, newest first, a page of 25 per "Load more".
export function usePastCycles(teamId: string | null) {
  const query = useInfiniteQuery({
    queryKey: qk.cycles(teamId ?? '', 'past'),
    queryFn: ({ pageParam }) =>
      fetchCycles({ ...teamFilter(teamId!), isPast: { eq: true } }, PAST_PAGE_SIZE, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.endCursor,
    enabled: teamId != null,
  });
  const items = mergeCyclePages((query.data?.pages ?? []).map((p) => p.items));
  return { ...query, items };
}

// One cycle by its team and number; null when the team has no such cycle.
export function useCycleByNumber(teamId: string | null, number: number) {
  return useQuery({
    queryKey: qk.cycle(teamId ?? '', number),
    queryFn: async () => {
      const filter = { ...teamFilter(teamId!), number: { eq: number } };
      const node = (await gqlRequest(CycleByNumberQuery, { filter })).cycles.nodes[0];
      return node ? toCycleSummary(node) : null;
    },
    enabled: teamId != null && Number.isInteger(number),
  });
}

const ArchivedIssuesPage = graphql(
  `
    query CycleArchivedIssues($filter: IssueFilter, $after: String, $first: Int) {
      issues(filter: $filter, first: $first, after: $after, includeArchived: true) {
        nodes {
          ...IssueFields
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  `,
  [IssueFields],
);

// A past cycle's archived issues. Its other issues are active, so they are in the
// board's issues already.
export function useArchivedCycleIssues(cycleId: string | null) {
  return useQuery({
    queryKey: qk.cycleArchivedIssues(cycleId ?? ''),
    queryFn: async (): Promise<Issue[]> => {
      const filter = { cycle: { id: { eq: cycleId } }, archivedAt: { null: false } };
      const nodes = await fetchAllPages(async (after, first) => {
        const data = await gqlRequest(ArchivedIssuesPage, { filter, after, first });
        return data.issues;
      });
      return nodes.map(toIssue);
    },
    enabled: cycleId != null,
  });
}

const CycleUpdate = graphql(
  `
    mutation CycleUpdate($id: String!, $input: CycleUpdateInput!) {
      cycleUpdate(id: $id, input: $input) {
        cycle {
          ...CycleFields
        }
      }
    }
  `,
  [CycleFields],
);

// Renames a cycle or changes its description. The scaffold's cycle list carries the
// names the pickers and board groups show, so it refreshes too.
export function useUpdateCycle(teamKey: string, teamId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; name?: string | null; description?: string | null }) => {
      const { id, ...input } = vars;
      return gqlRequest(CycleUpdate, { id, input });
    },
    onSuccess: ({ cycleUpdate: { cycle } }) => {
      if (!cycle) return;
      const updated = toCycleSummary(cycle);
      qc.setQueryData(qk.cycle(teamId, updated.number), updated);
      void qc.invalidateQueries({ queryKey: qk.anyCycles });
      void qc.invalidateQueries({ queryKey: qk.team(teamKey) });
    },
  });
}
