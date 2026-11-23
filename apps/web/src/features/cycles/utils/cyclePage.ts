import type { Issue, StateType } from '@/lib/api';
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

// A past cycle's numbers: the percent from the API's progress, and scope, started
// and completed from its last recorded day (its issues may be archived, so the board
// does not hold them all). 0 before the first recorded day.
export function cycleProgress(cycle: CycleHistories): CycleProgress {
  return {
    percent: toPercent(cycle.progress),
    scope: cycle.scopeHistory.at(-1) ?? 0,
    started: cycle.inProgressScopeHistory.at(-1) ?? 0,
    completed: cycle.completedScopeHistory.at(-1) ?? 0,
  };
}

// Rounded down, so the API's 0.999 ("open issues remain") never shows as 100%.
const toPercent = (progress: number) => Math.floor(progress * 100);

// A current or upcoming cycle's numbers from its issues on the board, weighted as the
// API's cycleProgress weighs them: completed issues count 1, started 0.25, canceled
// issues are left out; by estimate when any issue has one (an issue without counts
// 1), otherwise by issue count; 0.999 instead of 1 while open issues remain.
export function liveCycleProgress(
  issues: Issue[],
  stateTypeById: ReadonlyMap<string, StateType>,
): CycleProgress {
  const typed = issues.map((i) => ({ estimate: i.estimate, type: stateTypeById.get(i.stateId) }));
  const counted = typed.filter((r) => r.type !== 'canceled');
  const weighted = counted.some((r) => (r.estimate ?? 0) > 0);
  const weight = (r: { estimate: number | null }) => (weighted ? (r.estimate ?? 1) : 1);
  const sum = (list: typeof counted) => list.reduce((n, r) => n + weight(r), 0);
  const scope = sum(counted);
  const completed = sum(counted.filter((r) => r.type === 'completed'));
  const started = sum(counted.filter((r) => r.type === 'started'));
  let progress = scope > 0 ? (completed + 0.25 * started) / scope : 0;
  if (progress === 1 && counted.some((r) => r.type !== 'completed')) progress = 0.999;
  return { percent: toPercent(progress), scope, started, completed };
}

// A cycle's first and last day as UTC calendar dates ("YYYY-MM-DD"). Cycles start
// and end on UTC days, and endsAt is the moment the cycle ends, so the last day is
// the one holding the moment just before it.
export function cycleDays(startsAt: string, endsAt: string): { first: string; last: string } {
  return {
    first: new Date(startsAt).toISOString().slice(0, 10),
    last: new Date(new Date(endsAt).getTime() - 1).toISOString().slice(0, 10),
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

// The numbers a cycle shows: live from the board's issues while it is current or
// upcoming, the API's for a past cycle.
export function shownCycleProgress(
  cycle: CycleHistories & { id: string },
  team: { issues: Issue[]; states: { id: string; stateType: StateType }[] },
  now: Date,
): CycleProgress {
  if (new Date(cycle.endsAt).getTime() <= now.getTime()) return cycleProgress(cycle);
  const stateTypes = new Map(team.states.map((s) => [s.id, s.stateType]));
  return liveCycleProgress(cycleIssues(team.issues, cycle.id), stateTypes);
}
