import { format, startOfDay } from 'date-fns';
import { addDays, daysBetween } from '@/utils/dates';
import type { TimelineScale } from '@/utils/viewSettings';

// The date scale shared by the issue and project timelines: the day range, its day
// and month columns, and the conversions between dates and track pixels. Dates are
// calendar days (local midnight); distances are counted in calendar days, so a move
// across a month end or a daylight saving change shifts both ends by the same days.

// px per day at each zoom level. Wider days keep the per-day numbers legible;
// narrower days fit longer ranges and fall back to weekly gridlines.
export const SCALE_DAY_W: Record<TimelineScale, number> = { week: 32, month: 12, quarter: 5 };
export const LABEL_W = 256; // px, the left label column (matches w-64)
export const ROW_H = 36; // px, an item row
export const GROUP_H = 32; // px, a group header row

// A consecutive same-month run, for the month labels above the day numbers.
export interface MonthLabel {
  label: string;
  left: number;
  width: number;
}

export interface TimelineScaleModel {
  rangeStart: Date;
  dayWidth: number;
  days: Date[];
  months: MonthLabel[];
  trackWidth: number;
  todayLeft: number;
  todayInRange: boolean;
  dayLines: { backgroundImage: string };
  // The left edge of a day's column, and the day whose column holds `x`.
  xOf: (date: Date) => number;
  dateOf: (x: number) => Date;
  // A bar from `start` to `end`, both days included.
  spanToRect: (start: Date, end: Date) => { left: number; width: number };
}

// `from` / `to` are the earliest and latest content dates (null without content).
// The range runs from 3 days before `from` (else today) to 7 days after `to` (else
// today + 28), then extends with trailing days so the track fills the viewport.
export function timelineScale({
  from,
  to,
  zoom,
  viewportW,
  labelW,
  today = startOfDay(new Date()),
}: {
  from: Date | null;
  to: Date | null;
  zoom: TimelineScale;
  viewportW: number;
  labelW: number;
  today?: Date;
}): TimelineScaleModel {
  const dayW = SCALE_DAY_W[zoom];
  const rangeStart = addDays(from ?? today, -3);
  const rangeEnd = addDays(to ?? addDays(today, 28), 7);
  const naturalDays = Math.max(1, daysBetween(rangeStart, rangeEnd) + 1);
  const daysToFill = Math.ceil(Math.max(0, viewportW - labelW) / dayW);
  const totalDays = Math.max(naturalDays, daysToFill);
  const trackWidth = totalDays * dayW;
  const days = Array.from({ length: totalDays }, (_, i) => addDays(rangeStart, i));

  const months: MonthLabel[] = [];
  for (let i = 0; i < days.length; i++) {
    const label = format(days[i]!, 'MMMM yyyy');
    const last = months[months.length - 1];
    if (last && last.label === label) last.width += dayW;
    else months.push({ label, left: i * dayW, width: dayW });
  }

  // Per-day gridlines when days are wide; weekly gridlines when zoomed out, so
  // narrow days do not turn the track into solid lines.
  const gridPeriod = dayW >= 20 ? dayW : dayW * 7;
  const dayLines = {
    backgroundImage: `repeating-linear-gradient(to right, transparent 0, transparent ${gridPeriod - 1}px, var(--border) ${gridPeriod - 1}px, var(--border) ${gridPeriod}px)`,
  };
  const xOf = (date: Date) => daysBetween(rangeStart, date) * dayW;
  const dateOf = (x: number) => addDays(rangeStart, Math.floor(x / dayW));

  return {
    rangeStart,
    dayWidth: dayW,
    days,
    months,
    trackWidth,
    todayLeft: xOf(today),
    todayInRange: today >= rangeStart && today <= rangeEnd,
    dayLines,
    xOf,
    dateOf,
    spanToRect: (start, end) => ({ left: xOf(start), width: (daysBetween(start, end) + 1) * dayW }),
  };
}

// How a bar drag changes its dates: `move` shifts both, `start` / `end` move one end
// and never past the other.
export type DateDragMode = 'move' | 'start' | 'end';

export function dragDates({
  mode,
  start,
  end,
  deltaDays,
}: {
  mode: DateDragMode;
  start: Date;
  end: Date;
  deltaDays: number;
}): { start: Date; end: Date } {
  if (mode === 'move') return { start: addDays(start, deltaDays), end: addDays(end, deltaDays) };
  if (mode === 'end') {
    const next = addDays(end, deltaDays);
    return { start, end: next < start ? start : next };
  }
  const next = addDays(start, deltaDays);
  return { start: next > end ? end : next, end };
}

// Whole days for a pointer distance on the track.
export const dragDeltaDays = (dx: number, dayW: number): number => Math.round(dx / dayW);
