import { periodStart } from '@/utils/insights/data';
import type { DashboardPeriod } from './config';

const DAY_MS = 86_400_000;

export interface PeriodRange {
  start: Date;
  end: Date;
  // The start of the previous range of the same length, ending at `start`.
  previousStart: Date;
}

// A dashboard period: from midnight UTC, 30 or 90 days or 6 or 12 months back, to now.
export function periodRange(period: DashboardPeriod, now: Date): PeriodRange {
  let start: Date;
  if (period === '6m' || period === '12m') start = periodStart(period === '6m' ? 6 : 12, now);
  else {
    const days = period === '30d' ? 30 : 90;
    const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    start = new Date(midnight - days * DAY_MS);
  }
  return {
    start,
    end: now,
    previousStart: new Date(start.getTime() - (now.getTime() - start.getTime())),
  };
}

export function inRange(at: string | null | undefined, from: Date, to: Date): boolean {
  if (!at) return false;
  const t = new Date(at).getTime();
  return t >= from.getTime() && t < to.getTime();
}

// The Monday (UTC midnight) of the week holding `t`.
export function mondayOf(t: number): number {
  const day = new Date(t);
  const midnight = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
  return midnight - ((new Date(midnight).getUTCDay() + 6) % 7) * DAY_MS;
}

export const weekKey = (t: number): string => new Date(mondayOf(t)).toISOString().slice(0, 10);

// The Mondays ("YYYY-MM-DD") from the week holding the range's start to the week
// holding its end.
export function weekStarts(range: Pick<PeriodRange, 'start' | 'end'>): string[] {
  const out: string[] = [];
  for (let t = mondayOf(range.start.getTime()); t <= mondayOf(range.end.getTime()); t += 7 * DAY_MS)
    out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

export const daysBetween = (from: string, to: string | number): number =>
  ((typeof to === 'number' ? to : new Date(to).getTime()) - new Date(from).getTime()) / DAY_MS;
