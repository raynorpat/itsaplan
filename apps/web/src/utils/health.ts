import type { ProjectHealth } from '@/types/project';

// The health a project or an initiative shows: its latest update's (Linear's
// Project.health and Initiative.health). A loaded latest update wins over the read
// of the item, which can be older; `null` means the item has no updates, `undefined`
// that the updates are not loaded.
export function shownHealth(
  item: { health: ProjectHealth | null },
  latestUpdate: { health: ProjectHealth } | null | undefined,
): ProjectHealth | null {
  if (latestUpdate === undefined) return item.health;
  return latestUpdate?.health ?? null;
}
