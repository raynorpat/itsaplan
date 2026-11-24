'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { qk } from '@/services/queryKeys';
import type { IssueFilter } from '@/utils/viewFilters';
import { fetchCompletedIssues } from '../services/insightsIssues.service';
import { mergeInsightIssues, periodStart } from '../utils/data';
import type { InsightIssue } from '../utils/slices';

// The issues an Insights panel reads: the view's own issues (after its filters) plus
// the view's issues completed in the period. The completed issues are fetched only
// while `enabled` (the panel is open).
export function useInsightsData({
  enabled,
  viewKey,
  scope,
  viewIssues,
  periodMonths,
}: {
  enabled: boolean;
  viewKey: string;
  // Linear's IssueFilter for the view: its team, project, cycle or assignee scope and
  // its own filter.
  scope: IssueFilter;
  viewIssues: InsightIssue[];
  periodMonths: number;
}) {
  const since = periodStart(periodMonths, new Date());
  const sinceKey = since.toISOString();
  const query = useQuery({
    queryKey: qk.insightsCompleted(viewKey, JSON.stringify(scope), sinceKey),
    queryFn: () => fetchCompletedIssues(scope, since),
    enabled,
    staleTime: 60_000,
  });
  const fetched = query.data?.issues;
  const issues = useMemo(
    () => mergeInsightIssues(viewIssues, fetched ?? []),
    [viewIssues, fetched],
  );
  return {
    issues,
    capped: query.data?.capped ?? false,
    loading: enabled && query.isPending,
    error: query.isError,
    retry: () => void query.refetch(),
  };
}
