import type { Issue } from '@/lib/api';
import { appendPage } from '@/utils/appendPage';

// The fields of a cycle the progress numbers and the chart read. The histories hold
// one value per day since the cycle started, recorded by the API's daily upkeep.
export interface CycleHistories {
  startsAt: string;
  endsAt: string;
  progress: number;
  scopeHistory: number[];
  inProgressScopeHistory: number[];
  completedScopeHistory: number[];
}

export interface CycleProgress {
  percent: number;
  scope: number;
  started: number;
  completed: number;
}

export interface ChartPoint {
  day: string;
  scope: number;
  started: number;
  completed: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

// The issues of one cycle, from the team's board issues.
export function cycleIssues(issues: Issue[], cycleId: string): Issue[] {
  return issues.filter((issue) => issue.cycleId === cycleId);
}

// The percent done comes from the API's live progress; scope, started and completed
// are the last recorded day's values, 0 before the first one.
export function cycleProgress(cycle: CycleHistories): CycleProgress {
  return {
    percent: Math.round(cycle.progress * 100),
    scope: cycle.scopeHistory.at(-1) ?? 0,
    started: cycle.inProgressScopeHistory.at(-1) ?? 0,
    completed: cycle.completedScopeHistory.at(-1) ?? 0,
  };
}

// One point per recorded day (UTC dates from the cycle's start), never more than the
// cycle has days.
export function chartPoints(cycle: CycleHistories): ChartPoint[] {
  const start = new Date(cycle.startsAt).getTime();
  const days = Math.round((new Date(cycle.endsAt).getTime() - start) / DAY_MS);
  const recorded = Math.min(cycle.scopeHistory.length, days);
  return Array.from({ length: recorded }, (_, i) => ({
    day: new Date(start + i * DAY_MS).toISOString().slice(0, 10),
    scope: cycle.scopeHistory[i] ?? 0,
    started: cycle.inProgressScopeHistory[i] ?? 0,
    completed: cycle.completedScopeHistory[i] ?? 0,
  }));
}

// The loaded pages of past cycles as one list, newest (highest number) first. The
// server pages by creation time, and cycles created together can come in any order,
// so the list is sorted after the pages are joined.
export function mergeCyclePages<T extends { id: string; number: number }>(pages: T[][]): T[] {
  return pages
    .reduce<T[]>((all, page) => appendPage(all, page), [])
    .sort((a, b) => b.number - a.number);
}
