'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { qk } from '@/services/queryKeys';
import { fetchRequestSummaries } from '@/services/feedback.service';
import { withRequests } from '@/utils/requests';
import type { IssueFilter } from '@/utils/viewFilters';
import { fetchCompletedIssues, fetchOpenIssues } from '../services/insightsIssues.service';
import { mergeInsightIssues, periodStart, withinPeriod } from '@/utils/insights/data';
import { EMPTY_CONTEXT, mergeContext } from '@/utils/insights/context';
import type { InsightIssue, InsightsContext } from '@/utils/insights/slices';

// The issues an Insights panel reads: the view's own issues (after its filters) that
// are open or closed in the period, plus the view's issues completed in the period
// (without sub-issues when the view hides them). A view whose list does not hold its open
// issues in the panel's form (My issues) has them fetched too (`fetchOpen`). Nothing is
// fetched unless `enabled` (the panel is open).
export function useInsightsData({
  enabled,
  viewKey,
  scope,
  viewIssues,
  baseContext,
  periodMonths,
  showSubIssues,
  fetchOpen = false,
  readsRequests = false,
}: {
  enabled: boolean;
  viewKey: string;
  // Linear's IssueFilter for the view: its team, project, cycle or viewer scope and its
  // own filter.
  scope: IssueFilter;
  viewIssues: InsightIssue[];
  baseContext: InsightsContext;
  periodMonths: number;
  showSubIssues: boolean;
  fetchOpen?: boolean;
  // Whether the viewer reads feedback (not a guest): the scope's feedback counts are
  // then fetched for the Requests and Requesters measures.
  readsRequests?: boolean;
}) {
  const sinceKey = periodStart(periodMonths, new Date()).toISOString();
  const since = useMemo(() => new Date(sinceKey), [sinceKey]);
  const scopeKey = JSON.stringify(scope);

  const completed = useQuery({
    queryKey: qk.insightsCompleted(viewKey, scopeKey, `${sinceKey}:${showSubIssues}`),
    queryFn: () => fetchCompletedIssues(scope, since, showSubIssues),
    enabled,
    staleTime: 60_000,
  });
  const open = useQuery({
    queryKey: qk.insightsOpen(viewKey, `${scopeKey}:${showSubIssues}`),
    queryFn: () => fetchOpenIssues(scope, showSubIssues),
    enabled: enabled && fetchOpen,
    staleTime: 60_000,
  });

  const requests = useQuery({
    queryKey: qk.insightsRequests(viewKey, scopeKey),
    queryFn: () => fetchRequestSummaries(scope, { includeArchived: true }),
    enabled: enabled && readsRequests,
    staleTime: 60_000,
  });

  const issues = useMemo(
    () =>
      withRequests(
        mergeInsightIssues(
          withinPeriod(mergeInsightIssues(viewIssues, open.data?.issues ?? []), since),
          completed.data?.issues ?? [],
        ),
        requests.data,
      ),
    [viewIssues, open.data, completed.data, since, requests.data],
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
