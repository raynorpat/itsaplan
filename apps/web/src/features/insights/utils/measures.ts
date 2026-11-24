import type { InsightsSettings, Measure } from './settings';
import { sliceIssues, type InsightIssue, type InsightsContext } from './slices';
import { timeStats } from './stats';

const DAY_MS = 86_400_000;

export function isTimeMeasure(measure: Measure): boolean {
  return measure === 'cycleTime' || measure === 'leadTime' || measure === 'age';
}

function daysBetween(from: string, to: number): number {
  return (to - new Date(from).getTime()) / DAY_MS;
}

// One issue's value for a measure, or null when the measure does not apply to it:
// - count: 1;
// - points: the estimate (an unestimated issue adds nothing);
// - cycleTime: days from start to completion (completed issues with a start);
// - leadTime: days from creation to completion (completed issues);
// - age: days from creation to `now` (open issues: neither completed nor canceled).
export function measureValue(issue: InsightIssue, measure: Measure, now: Date): number | null {
  switch (measure) {
    case 'count':
      return 1;
    case 'points':
      return issue.estimate ?? 0;
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
  return issues.reduce((n, i) => n + (measureValue(i, measure, now) ?? 0), 0);
}

// The value of a group of issues: the sum for count and points, the median for a time
// measure (0 when no issue has a value).
function groupValue(issues: InsightIssue[], measure: Measure, now: Date): number {
  if (!isTimeMeasure(measure)) return total(issues, measure, now);
  const values = issues
    .map((i) => measureValue(i, measure, now))
    .filter((v): v is number => v != null);
  return timeStats(values)?.median ?? 0;
}

// The panel's bars: one row per slice in its natural order, split by the segment
// field when one is set.
export function breakdown(
  issues: InsightIssue[],
  settings: Pick<InsightsSettings, 'measure' | 'slice' | 'segment'>,
  ctx: InsightsContext,
  now: Date = new Date(),
): BreakdownRow[] {
  const { measure, slice, segment } = settings;
  const all = isTimeMeasure(measure) ? 0 : total(issues, measure, now);
  return sliceIssues(issues, slice, ctx).map((s) => {
    const value = groupValue(s.issues, measure, now);
    return {
      key: s.key,
      label: s.label,
      value,
      share: all > 0 ? value / all : 0,
      segments: segment
        ? sliceIssues(s.issues, segment, ctx).map((g) => ({
            key: g.key,
            label: g.label,
            value: groupValue(g.issues, measure, now),
          }))
        : [],
    };
  });
}
