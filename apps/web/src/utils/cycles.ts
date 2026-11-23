import type { TeamCycleSettings } from '@/lib/api';

// Whether cycle controls are shown for a team: only when its cycles are on, and
// never while the team scaffold is still loading.
export function cyclesVisible(
  scaffold: { cycles: Pick<TeamCycleSettings, 'enabled'> } | null | undefined,
): boolean {
  return scaffold?.cycles.enabled ?? false;
}
