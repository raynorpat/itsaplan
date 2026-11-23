import type { Cycle, TeamCycleSettings } from '@/lib/api';

// Whether cycle controls are shown for a team: only when its cycles are on, and
// never while the team scaffold is still loading.
export function cyclesVisible(
  scaffold: { cycles: Pick<TeamCycleSettings, 'enabled'> } | null | undefined,
): boolean {
  return scaffold?.cycles.enabled ?? false;
}

// A cycle's display name: its name, or "Cycle N" when it has none.
export function cycleLabel(cycle: Pick<Cycle, 'name' | 'number'>): string {
  return cycle.name?.trim() || `Cycle ${cycle.number}`;
}

const time = (iso: string) => new Date(iso).getTime();

function isCurrent(cycle: Cycle, now: number): boolean {
  return cycle.completedAt == null && time(cycle.startsAt) <= now && now < time(cycle.endsAt);
}

// The cycles an issue can be put in: the current one (none during a cooldown) and
// the upcoming ones, soonest first.
export function cycleOptions(
  cycles: Cycle[],
  now: Date,
): { current: Cycle | undefined; upcoming: Cycle[] } {
  const at = now.getTime();
  return {
    current: cycles.find((c) => isCurrent(c, at)),
    upcoming: cycles
      .filter((c) => time(c.startsAt) > at)
      .sort((a, b) => time(a.startsAt) - time(b.startsAt)),
  };
}

// The cycles an issue can be moved to, as one list: the current one, then the
// upcoming ones.
export function assignableCycles(cycles: Cycle[], now: Date): Cycle[] {
  const { current, upcoming } = cycleOptions(cycles, now);
  return current ? [current, ...upcoming] : upcoming;
}

// Every cycle in the order the filter and the board's cycle groups list them: the
// current one, the upcoming ones soonest first, then the past ones newest first.
export function sortedCycles(cycles: Cycle[], now: Date): Cycle[] {
  const { current, upcoming } = cycleOptions(cycles, now);
  const shown = new Set([current?.id, ...upcoming.map((c) => c.id)]);
  const past = cycles
    .filter((c) => !shown.has(c.id))
    .sort((a, b) => time(b.endsAt) - time(a.endsAt));
  return [...(current ? [current] : []), ...upcoming, ...past];
}

// Display options (grouping fields, properties) without the cycle one when the
// team's cycles are off.
export function withoutCycleOptions<T extends { value: string }>(
  options: T[],
  cyclesOn: boolean,
): T[] {
  return cyclesOn ? options : options.filter((o) => o.value !== 'cycle');
}
