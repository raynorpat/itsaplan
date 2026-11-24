import type { IssueFilter } from '@/utils/viewFilters';
import type { InsightIssue } from './slices';

// The first moment of an Insights period: midnight UTC, `months` before `now`, on the
// same day of the month or the last day of a shorter month (Mar 31 → Feb 28). Day
// precision keeps the fetched issues' cache key stable through the day.
export function periodStart(months: number, now: Date): Date {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() - months;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(now.getUTCDate(), lastDay)));
}

// The issues the period covers: open ones, and closed ones closed since `since`.
export function withinPeriod<T extends Pick<InsightIssue, 'completedAt' | 'canceledAt'>>(
  issues: T[],
  since: Date,
): T[] {
  const from = since.getTime();
  return issues.filter((i) => {
    const closed = i.completedAt ?? i.canceledAt;
    return closed == null || new Date(closed).getTime() >= from;
  });
}

// Linear's IssueFilter for a view's issues completed since `since`; without the
// view's sub-issues when it hides them.
export function completedIssuesFilter(
  scope: IssueFilter,
  since: Date,
  showSubIssues: boolean,
): IssueFilter {
  return {
    and: [
      scope,
      { completedAt: { gte: since.toISOString() } },
      ...(showSubIssues ? [] : [{ parent: { null: true } }]),
    ],
  };
}

// The panel's issues: the view's own (which reflect edits made on the page) and each
// fetched completed issue the view does not hold.
export function mergeInsightIssues(
  viewIssues: InsightIssue[],
  fetched: InsightIssue[],
): InsightIssue[] {
  const ids = new Set(viewIssues.map((i) => i.id));
  return [...viewIssues, ...fetched.filter((i) => !ids.has(i.id))];
}
