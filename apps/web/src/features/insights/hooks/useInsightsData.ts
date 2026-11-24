'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { qk } from '@/services/queryKeys';
import type { IssueFilter } from '@/utils/viewFilters';
import { fetchCompletedIssues, fetchOpenIssues } from '../services/insightsIssues.service';
import { mergeInsightIssues, periodStart } from '../utils/data';
import { EMPTY_CONTEXT, mergeContext } from '../utils/context';
import type { InsightIssue, InsightsContext } from '../utils/slices';

// The issues an Insights panel reads: the view's own issues (after its filters) plus
// the view's issues completed in the period. A view whose list does not hold its open
// issues in the panel's form (My issues) has them fetched too (`fetchOpen`). Nothing is
// fetched unless `enabled` (the panel is open).
export function useInsightsData({
  enabled,
  viewKey,
  scope,
  viewIssues,
  baseContext,
  periodMonths,
  fetchOpen = false,
}: {
  enabled: boolean;
  viewKey: string;
  // Linear's IssueFilter for the view: its team, project, cycle or viewer scope and its
  // own filter.
  scope: IssueFilter;
  viewIssues: InsightIssue[];
  baseContext: InsightsContext;
  periodMonths: number;
  fetchOpen?: boolean;
}) {
  const since = periodStart(periodMonths, new Date());
  const sinceKey = since.toISOString();
  const scopeKey = JSON.stringify(scope);

  const completed = useQuery({
    queryKey: qk.insightsCompleted(viewKey, scopeKey, sinceKey),
    queryFn: () => fetchCompletedIssues(scope, since),
    enabled,
    staleTime: 60_000,
  });
  const open = useQuery({
    queryKey: qk.insightsCompleted(viewKey, scopeKey, 'open'),
    queryFn: () => fetchOpenIssues(scope),
    enabled: enabled && fetchOpen,
    staleTime: 60_000,
  });

  const issues = useMemo(
    () =>
      mergeInsightIssues(
        mergeInsightIssues(viewIssues, open.data?.issues ?? []),
        completed.data?.issues ?? [],
      ),
    [viewIssues, open.data, completed.data],
  );
  const context = useMemo(
    () =>
      mergeContext(
        baseContext,
        mergeContext(open.data?.names ?? EMPTY_CONTEXT, completed.data?.names ?? EMPTY_CONTEXT),
      ),
    [baseContext, open.data, completed.data],
  );

  const queries = fetchOpen ? [completed, open] : [completed];
  return {
    issues,
    context,
    capped: queries.some((q) => q.data?.capped),
    loading: enabled && queries.some((q) => q.isPending),
    error: queries.some((q) => q.isError),
    retry: () => queries.forEach((q) => void q.refetch()),
  };
}
