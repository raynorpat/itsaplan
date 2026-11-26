import { progressPercent } from '@/utils/progress';

// The project progress chart's data: Linear's daily history arrays (oldest first) as
// dated points and the header figures.

export interface ProgressPoint {
  date: string;
  scope: number;
  started: number;
  completed: number;
}

export type ProgressUnit = 'points' | 'issues';

const DAY_MS = 86_400_000;

const utcDay = (value: string | Date): number => {
  const d = typeof value === 'string' ? new Date(value) : value;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};

const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

// One point per stored day. The series begins on the project's start date (its
// creation date without one); an open project's last value is today, so a series
// that would run past today (a start date still ahead) is anchored to end today.
export function progressSeries(
  p: {
    startDate: string | null;
    createdAt: string;
    scopeHistory: number[];
    completedScopeHistory: number[];
    inProgressScopeHistory: number[];
  },
  now: Date = new Date(),
): ProgressPoint[] {
  const days = p.scopeHistory.length;
  if (days === 0) return [];
  const start = utcDay(p.startDate ?? p.createdAt);
  const first = Math.min(start, utcDay(now) - (days - 1) * DAY_MS);
  return p.scopeHistory.map((scope, i) => ({
    date: isoDay(first + i * DAY_MS),
    scope,
    started: p.inProgressScopeHistory[i] ?? 0,
    completed: p.completedScopeHistory[i] ?? 0,
  }));
}

// Points when the weighted histories differ from the issue counts, issues otherwise
// (the API weighs by estimate only when an issue has one).
export function progressUnit(h: {
  scopeHistory: number[];
  completedScopeHistory: number[];
  issueCountHistory: number[];
  completedIssueCountHistory: number[];
}): ProgressUnit {
  const same = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => v === b[i]);
  return same(h.scopeHistory, h.issueCountHistory) &&
    same(h.completedScopeHistory, h.completedIssueCountHistory)
    ? 'issues'
    : 'points';
}

const amount = (value: number) => Number(value.toFixed(1)).toString();

const share = (value: number, scope: number) => (scope > 0 ? progressPercent(value / scope) : 0);

export function progressHeader(
  last: { scope: number; started: number; completed: number },
  unit: ProgressUnit,
): string {
  const noun = unit === 'points' ? 'point' : 'issue';
  const scope = `Scope ${amount(last.scope)} ${noun}${last.scope === 1 ? '' : 's'}`;
  const started = `Started ${amount(last.started)} (${share(last.started, last.scope)}%)`;
  const completed = `Completed ${amount(last.completed)} (${share(last.completed, last.scope)}%)`;
  return `${scope} · ${started} · ${completed}`;
}

// The chart's days: the series, then empty days up to a target date after it, so the
// target line has a place on the time axis. A cap keeps a far target from making
// thousands of empty points.
const MAX_FUTURE_DAYS = 730;

export function chartDays(
  series: ProgressPoint[],
  targetDate: string | null,
): (ProgressPoint | { date: string })[] {
  const last = series[series.length - 1];
  if (!last || !targetDate) return series;
  const end = utcDay(targetDate);
  const out: (ProgressPoint | { date: string })[] = [...series];
  for (
    let day = utcDay(last.date) + DAY_MS, n = 0;
    day <= end && n < MAX_FUTURE_DAYS;
    day += DAY_MS, n++
  )
    out.push({ date: isoDay(day) });
  return out;
}
