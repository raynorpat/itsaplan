// The API archives a completed or an upcoming cycle and refuses the active one. The
// cycles page offers it on completed cycles only: upcoming cycles are the ones the
// team's cycle settings keep, and the upkeep creates them again.
export function canArchiveCycle(cycle: {
  completedAt: string | null;
  archivedAt?: string | null;
}): boolean {
  return cycle.completedAt != null && cycle.archivedAt == null;
}
