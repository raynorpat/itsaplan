import type { InsightIssue } from './slices';

// The first moment of an Insights period: midnight UTC, `months` before `now`. Day
// precision keeps the fetched issues' cache key stable through the day.
export function periodStart(months: number, now: Date): Date {
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, now.getUTCDate()),
  );
  return start;
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
