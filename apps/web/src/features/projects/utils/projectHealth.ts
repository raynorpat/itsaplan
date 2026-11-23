import { type ProjectHealth } from '@/lib/api';

// The health a project shows: its latest update's (Linear's Project.health). A
// loaded latest update wins over the project read, which can be older; `null` means
// the project has no updates, `undefined` that the updates are not loaded.
export function projectHealth(
  project: { health: ProjectHealth | null },
  latestUpdate: { health: ProjectHealth } | null | undefined,
): ProjectHealth | null {
  if (latestUpdate === undefined) return project.health;
  return latestUpdate?.health ?? null;
}
