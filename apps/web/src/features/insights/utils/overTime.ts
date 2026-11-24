import type { InsightIssue } from './slices';

const DAY_MS = 86_400_000;

export interface WeekCount {
  // The Monday the week starts on (UTC), "YYYY-MM-DD".
  weekStart: string;
  created: number;
  completed: number;
}

// The Monday (UTC, midnight) of the week holding `t`.
function mondayOf(t: number): number {
  const day = new Date(t);
  const midnight = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
  const sinceMonday = (new Date(midnight).getUTCDay() + 6) % 7;
  return midnight - sinceMonday * DAY_MS;
}

// Issues created and issues completed per week, from the week holding the start of
// the period (`periodMonths` before `now`) to the current week, with a zero for weeks
// that have neither.
export function weeklyCreatedCompleted(
  issues: InsightIssue[],
  periodMonths: number,
  now: Date,
): WeekCount[] {
  const from = new Date(now);
  from.setUTCMonth(from.getUTCMonth() - periodMonths);
  const first = mondayOf(from.getTime());
  const last = mondayOf(now.getTime());
  const weeks = new Map<number, WeekCount>();
  for (let t = first; t <= last; t += 7 * DAY_MS) {
    weeks.set(t, { weekStart: new Date(t).toISOString().slice(0, 10), created: 0, completed: 0 });
  }
  for (const issue of issues) {
    const created = weeks.get(mondayOf(new Date(issue.createdAt).getTime()));
    if (created) created.created += 1;
    if (issue.completedAt) {
      const completed = weeks.get(mondayOf(new Date(issue.completedAt).getTime()));
      if (completed) completed.completed += 1;
    }
  }
  return [...weeks.values()];
}
