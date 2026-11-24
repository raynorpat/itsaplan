const DAY_MS = 24 * 60 * 60 * 1000;

// The API archives a completed or an upcoming cycle and refuses the active one. The
// cycles page offers it on completed cycles only: upcoming cycles are the ones the
// team's cycle settings keep, and the upkeep creates them again.
export function canArchiveCycle(cycle: {
  completedAt: string | null;
  archivedAt?: string | null;
}): boolean {
  return cycle.completedAt != null && cycle.archivedAt == null;
}

export interface NewCycleForm {
  name: string;
  // "YYYY-MM-DD", from a date input.
  startsAt: string;
  endsAt: string;
}

export interface NewCycleInput {
  teamId: string;
  name?: string;
  startsAt: string;
  endsAt: string;
}

// The "New cycle" form as cycleCreate's input. Cycles run on UTC days: the cycle
// starts at the start of its first day and ends at the start of the day after its
// last day (endsAt is the moment it ends). The end day may be the start day.
export function newCycleInput(
  form: NewCycleForm,
  teamId: string,
): NewCycleInput | { error: string } {
  if (!form.startsAt || !form.endsAt) return { error: 'Choose a start and an end date.' };
  const start = Date.parse(`${form.startsAt}T00:00:00.000Z`);
  const lastDay = Date.parse(`${form.endsAt}T00:00:00.000Z`);
  if (Number.isNaN(start) || Number.isNaN(lastDay))
    return { error: 'Choose a start and an end date.' };
  if (lastDay < start) return { error: 'The end date must not be before the start date.' };
  const name = form.name.trim();
  return {
    teamId,
    ...(name ? { name } : {}),
    startsAt: new Date(start).toISOString(),
    endsAt: new Date(lastDay + DAY_MS).toISOString(),
  };
}
