import {
  fetchInsightIssues,
  INSIGHTS_ISSUE_LIMIT,
  type InsightsFetch,
} from '@/services/insightIssues.service';
import { completedIssuesFilter } from '@/utils/insights/data';
import type { IssueFilter } from '@/utils/viewFilters';

export { INSIGHTS_ISSUE_LIMIT, type InsightsFetch };

// The issues of a view (`scope`, Linear's IssueFilter for the view) completed since
// `since`, at most INSIGHTS_ISSUE_LIMIT. Pages come most recently updated first (the
// API's closest order to "most recently completed"), so the cap drops the oldest.
export function fetchCompletedIssues(
  scope: IssueFilter,
  since: Date,
  showSubIssues: boolean,
): Promise<InsightsFetch> {
  return fetchInsightIssues(
    completedIssuesFilter(scope, since, showSubIssues),
    INSIGHTS_ISSUE_LIMIT,
  );
}

// The open issues of a view whose list does not hold them in a form the panel reads
// (My issues), at most INSIGHTS_ISSUE_LIMIT.
export function fetchOpenIssues(
  scope: IssueFilter,
  showSubIssues: boolean,
): Promise<InsightsFetch> {
  return fetchInsightIssues(
    {
      and: [
        scope,
        { state: { type: { nin: ['completed', 'canceled'] } } },
        ...(showSubIssues ? [] : [{ parent: { null: true } }]),
      ],
    },
    INSIGHTS_ISSUE_LIMIT,
  );
}
