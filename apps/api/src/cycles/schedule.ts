// Cycle boundaries on UTC days (teams have no time zone yet). A cycle starts at
// 00:00 UTC on the team's start day (0 = Sunday … 6 = Saturday), lasts `duration`
// weeks, and the next one starts `cooldown` weeks after it ends, moved forward to
// the next start day.

export interface CycleSettings {
  duration: number;
  startDay: number;
  cooldown: number;
  upcoming: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

// The most recent start day at or before `now`, at 00:00 UTC.
export function currentCycleStart(settings: CycleSettings, now: Date): Date {
  const day = startOfUtcDay(now);
  const back = (day.getUTCDay() - settings.startDay + 7) % 7;
  return new Date(day.getTime() - back * DAY_MS);
}

export function cycleEnd(start: Date, settings: CycleSettings): Date {
  return new Date(start.getTime() + settings.duration * WEEK_MS);
}

// The start of the cycle after one ending at `prevEnd`: the cooldown later, on the
// first start day at or after that moment.
export function nextCycleStart(prevEnd: Date, settings: CycleSettings): Date {
  const earliest = new Date(prevEnd.getTime() + settings.cooldown * WEEK_MS);
  let day = startOfUtcDay(earliest);
  if (day < earliest) day = new Date(day.getTime() + DAY_MS);
  const forward = (settings.startDay - day.getUTCDay() + 7) % 7;
  return new Date(day.getTime() + forward * DAY_MS);
}
