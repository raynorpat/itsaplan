import { estimatesUsed, type TeamEstimateSettings } from '@/utils/estimates';
import { sliceIssues, type InsightIssue, type InsightsContext, type SliceField } from './slices';

// The figures the Insights panel measures issues by.
export type Measure =
  | 'count'
  | 'points'
  | 'requests'
  | 'requesters'
  | 'customers'
  | 'customerRevenue'
  | 'cycleTime'
  | 'leadTime'
  | 'age';

const DAY_MS = 86_400_000;

export function isTimeMeasure(measure: Measure): boolean {
  return measure === 'cycleTime' || measure === 'leadTime' || measure === 'age';
}

function daysBetween(from: string, to: number): number {
  return (to - new Date(from).getTime()) / DAY_MS;
}

// The issue as its team's estimate settings show it: the stored estimate hidden while
// the team does not use estimates (counted by issue, 1), else an unestimated issue
// counting the team's default estimate, as cycle and project progress count it.
export function withTeamEstimate<T extends InsightIssue>(
  issue: T,
  settings: TeamEstimateSettings | undefined,
): T {
  if (!settings) return issue;
  if (!estimatesUsed(settings)) return { ...issue, estimate: null, defaultEstimate: 1 };
  return { ...issue, defaultEstimate: settings.defaultEstimate };
}

// One issue's value for a measure, or null when the measure does not apply to it:
// - count: 1;
// - points: the estimate, an unestimated issue counting its team's default estimate
//   (as progress does; withTeamEstimate), else 1; the panel offers points only when
//   the issues have estimates;
// - requests: the issue's feedback items; requesters: the distinct people asking
//   (a slice's total counts each person once, see total);
// - customers: the customer count (RequestSummary.customerKeys); customerRevenue: the
//   revenue of the customers asking (each customer once in a slice's total);
// - cycleTime: days from start to completion (completed issues with a start);
// - leadTime: days from creation to completion (completed issues);
// - age: days from creation to `now` (open issues: neither completed nor canceled).
export function measureValue(issue: InsightIssue, measure: Measure, now: Date): number | null {
  switch (measure) {
    case 'count':
      return 1;
    case 'points':
      return issue.estimate ?? issue.defaultEstimate ?? 1;
    case 'requests':
      return issue.requests?.count ?? 0;
    case 'requesters':
      return issue.requests?.requesterIds.length ?? 0;
    case 'customers':
      return issue.requests?.customerKeys?.length ?? 0;
    case 'customerRevenue':
      return Object.values(issue.requests?.customerRevenue ?? {}).reduce((a, b) => a + b, 0);
    case 'cycleTime':
      if (!issue.startedAt || !issue.completedAt) return null;
      return daysBetween(issue.startedAt, new Date(issue.completedAt).getTime());
    case 'leadTime':
      if (!issue.completedAt) return null;
      return daysBetween(issue.createdAt, new Date(issue.completedAt).getTime());
    case 'age':
      if (issue.completedAt || issue.canceledAt) return null;
      return daysBetween(issue.createdAt, now.getTime());
  }
}

export interface BreakdownSegment {
  key: string;
  label: string;
  value: number;
}

export interface BreakdownRow {
  key: string;
  label: string;
  value: number;
  // The row's value over the total of all issues (each issue counted once, so label
  // shares may add up to more than 1).
  share: number;
  segments: BreakdownSegment[];
}

function total(issues: InsightIssue[], measure: Measure, now: Date): number {
  // A person asking on several issues of a slice counts once.
  if (measure === 'requesters')
    return new Set(issues.flatMap((i) => i.requests?.requesterIds ?? [])).size;
  if (measure === 'customers')
    return new Set(issues.flatMap((i) => i.requests?.customerKeys ?? [])).size;
  if (measure === 'customerRevenue') {
    const revenue: Record<string, number> = {};
    for (const i of issues) Object.assign(revenue, i.requests?.customerRevenue);
    return Object.values(revenue).reduce((a, b) => a + b, 0);
  }
  return issues.reduce((n, i) => n + (measureValue(i, measure, now) ?? 0), 0);
}

// The panel's bars for count or points (time measures go to timeRows): one row per
// slice in its natural order, split by the segment field when one is set. Every row
// lists the same segments, in the segment field's natural order, with 0 where the
// row has none, so the stack and legend order is the same for all rows.
export function breakdown(
  issues: InsightIssue[],
  settings: { measure: Measure; slice: SliceField; segment: SliceField | null },
  ctx: InsightsContext,
  now: Date = new Date(),
): BreakdownRow[] {
  const { measure, slice, segment } = settings;
  const all = total(issues, measure, now);
  const order = segment ? sliceIssues(issues, segment, ctx) : [];
  return sliceIssues(issues, slice, ctx).map((s) => {
    const value = total(s.issues, measure, now);
    const inRow = segment
      ? new Map(sliceIssues(s.issues, segment, ctx).map((g) => [g.key, g.issues]))
      : new Map<string, InsightIssue[]>();
    return {
      key: s.key,
      label: s.label,
      value,
      share: all > 0 ? value / all : 0,
      segments: order.map((g) => ({
        key: g.key,
        label: g.label,
        value: total(inRow.get(g.key) ?? [], measure, now),
      })),
    };
  });
}
