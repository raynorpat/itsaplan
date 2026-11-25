import type { ProjectHealth } from '@/types/project';

export type InitiativeSortKey = 'name' | 'health' | 'owner' | 'targetDate' | 'projects';

export interface SortableInitiative {
  id: string;
  name: string;
  health: ProjectHealth | null;
  targetDate: string | null;
  owner: { name: string } | null;
  projectCount: number;
}

const HEALTH_ORDER: Record<ProjectHealth, number> = { onTrack: 0, atRisk: 1, offTrack: 2 };

// Sorts the loaded initiatives in the browser (the list loads whole). Text ignores
// case; an initiative without health, owner or target date sorts last in either
// direction, as in the projects list; ties keep the loaded order.
export function sortInitiatives<T extends SortableInitiative>(
  rows: T[],
  sort: InitiativeSortKey | undefined,
  dir: 'asc' | 'desc',
): T[] {
  if (!sort) return rows;
  const keyOf = (r: T): string | number | null => {
    switch (sort) {
      case 'name':
        return r.name.toLowerCase();
      case 'health':
        return r.health ? HEALTH_ORDER[r.health] : null;
      case 'owner':
        return r.owner ? r.owner.name.toLowerCase() : null;
      case 'targetDate':
        return r.targetDate;
      case 'projects':
        return r.projectCount;
    }
  };
  const sign = dir === 'desc' ? -1 : 1;
  return rows
    .map((r, i) => ({ r, i, key: keyOf(r) }))
    .sort((a, b) => {
      if (a.key === null || b.key === null) {
        if (a.key === b.key) return a.i - b.i;
        return a.key === null ? 1 : -1;
      }
      if (a.key < b.key) return -sign;
      if (a.key > b.key) return sign;
      return a.i - b.i;
    })
    .map((x) => x.r);
}

// The direction a column starts in when picked: project count descending (most
// first), everything else ascending.
export const firstDirection = (key: InitiativeSortKey): 'asc' | 'desc' =>
  key === 'projects' ? 'desc' : 'asc';
