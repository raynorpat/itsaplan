'use client';

import { useMemo } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { graphql, gqlRequest } from '@/lib/graphql';
import { qk } from '@/services/queryKeys';
import { useCustomersEnabled } from '@/hooks/useCustomersEnabled';
import { fetchAllPages } from '@/utils/fetchAllPages';
import type { Issue } from '@/types/issue';
import { issuesVersion, type SortContext } from '@/utils/team';
import type { Sort } from '@/utils/viewTypes';

// The team's active issue ids in the order the API sorts them, for the two orderings
// whose values the board does not load: release (the most recent release date) and
// link count. Asked only while one of them is the chosen ordering.
const IssueOrderPage = graphql(`
  query IssueOrderRanks(
    $filter: IssueFilter
    $sort: [IssueSortInput!]
    $after: String
    $first: Int
  ) {
    issues(filter: $filter, sort: $sort, first: $first, after: $after) {
      nodes {
        id
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`);

async function fetchRanks(teamKey: string, sort: Sort): Promise<Map<string, number>> {
  const order = sort.dir === 'desc' ? ('Descending' as const) : ('Ascending' as const);
  const key = sort.field === 'release' ? { release: { order } } : { linkCount: { order } };
  const nodes = await fetchAllPages(async (after, first) => {
    const data = await gqlRequest(IssueOrderPage, {
      filter: { team: { key: { eq: teamKey } } },
      sort: [key],
      after,
      first,
    });
    return data.issues;
  });
  return new Map(nodes.map((n, i) => [n.id, i]));
}

// What sortIssues needs beyond the issues for a team's list: whether Customers is on,
// and the API's ranks for the release and link count orderings. The ranks are asked
// again whenever the loaded issues change (issuesVersion) and after a link or release
// write (qk.anyIssueOrderRanks); the previous ranks stay in use meanwhile, so only the
// first load shows the tie-break order.
export function useIssueSortContext(teamKey: string, sort: Sort, issues: Issue[]): SortContext {
  const customersOn = useCustomersEnabled();
  const ranked = sort.field === 'release' || sort.field === 'linkCount';
  const version = useMemo(() => issuesVersion(issues), [issues]);
  const ranks = useQuery({
    queryKey: qk.issueOrderRanks(teamKey, sort.field, sort.dir, version),
    queryFn: () => fetchRanks(teamKey, sort),
    enabled: ranked,
    placeholderData: keepPreviousData,
  });
  const data = ranked ? ranks.data : undefined;
  return useMemo(() => ({ customersOn, ranks: data }), [customersOn, data]);
}
