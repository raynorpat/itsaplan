import { measureValue, type Measure } from './measures';
import { sliceIssues, type InsightIssue, type InsightsContext, type SliceField } from './slices';

export interface TimeStats {
  median: number;
  p25: number;
  p75: number;
  count: number;
}

// The value at fraction `q` of sorted values, interpolating between neighbours (the
// usual "linear" percentile, as spreadsheets compute it).
function percentile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lower = Math.floor(pos);
  const upper = Math.ceil(pos);
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (pos - lower);
}

// Median and quartiles of durations, or null when there are none.
export function timeStats(values: number[]): TimeStats | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return {
    median: percentile(sorted, 0.5),
    p25: percentile(sorted, 0.25),
    p75: percentile(sorted, 0.75),
    count: sorted.length,
  };
}

export interface TimePoint {
  issueId: string;
  identifier: string;
  title: string;
  // Where the dot sits on the time axis: the completion date, or the creation date for age.
  at: string;
  days: number;
}

export interface TimeRow {
  key: string;
  label: string;
  stats: TimeStats;
  points: TimePoint[];
}

export interface TimeRowsResult {
  rows: TimeRow[];
  all: TimeStats | null;
  // Completed issues left out of cycle time because they were never started.
  excluded: number;
}

// Per slice, the statistics and the dots of a time measure. Slices without a value
// are left out.
export function timeRows(
  issues: InsightIssue[],
  measure: Measure,
  slice: SliceField,
  ctx: InsightsContext,
  now: Date = new Date(),
): TimeRowsResult {
  const point = (issue: InsightIssue): TimePoint | null => {
    const days = measureValue(issue, measure, now);
    if (days == null) return null;
    return {
      issueId: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      at: measure === 'age' ? issue.createdAt : issue.completedAt!,
      days,
    };
  };
  const rows: TimeRow[] = [];
  for (const s of sliceIssues(issues, slice, ctx)) {
    const points = s.issues.map(point).filter((p): p is TimePoint => p != null);
    const stats = timeStats(points.map((p) => p.days));
    if (stats) rows.push({ key: s.key, label: s.label, stats, points });
  }
  const values = issues
    .map((i) => measureValue(i, measure, now))
    .filter((v): v is number => v != null);
  const excluded =
    measure === 'cycleTime' ? issues.filter((i) => i.completedAt && !i.startedAt).length : 0;
  return { rows, all: timeStats(values), excluded };
}
