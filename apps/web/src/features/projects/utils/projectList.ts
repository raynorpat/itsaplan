import type { ProjectCounts, ProjectStatus } from '@/lib/api';

const STATUSES: ProjectStatus[] = [
  'backlog',
  'planned',
  'started',
  'paused',
  'completed',
  'canceled',
];

// Adds a "Load more" page to the loaded rows. A row the page repeats (the list
// shifted because a project was created or moved between pages) keeps its first
// position and takes the page's newer copy.
export function appendPage<T extends { id: string }>(current: T[], page: T[]): T[] {
  const index = new Map(current.map((row, i) => [row.id, i]));
  const out = [...current];
  for (const row of page) {
    const at = index.get(row.id);
    if (at === undefined) {
      index.set(row.id, out.length);
      out.push(row);
    } else out[at] = row;
  }
  return out;
}

// The status tab counts from the number of projects per status type; a status with
// no projects counts 0.
export function sumStatusCounts(perStatus: Partial<Record<ProjectStatus, number>>): ProjectCounts {
  const counts = { total: 0 } as ProjectCounts;
  for (const status of STATUSES) {
    counts[status] = perStatus[status] ?? 0;
    counts.total += counts[status];
  }
  return counts;
}

type SortableProject = {
  name: string;
  priority: number;
  targetDate: string | null;
  leadUserId: string | null;
};

// Sorts the loaded rows: Linear's project list has no server-side sort, so a sort
// applies to what "Load more" has fetched so far. Missing values (no priority, no
// target date, no lead) sort last in either direction; ties keep the server order.
export function sortProjects<T extends SortableProject>(
  projects: T[],
  sort: 'name' | 'priority' | 'targetDate' | 'lead' | undefined,
  dir: 'asc' | 'desc',
  leadName: (userId: string | null) => string,
): T[] {
  if (!sort) return projects;
  const keyOf = (p: T): string | number | null => {
    switch (sort) {
      case 'name':
        return p.name.toLowerCase();
      case 'priority':
        return p.priority === 0 ? null : p.priority;
      case 'targetDate':
        return p.targetDate;
      case 'lead':
        return leadName(p.leadUserId).toLowerCase() || null;
    }
  };
  const sign = dir === 'desc' ? -1 : 1;
  return projects
    .map((p, i) => ({ p, i, key: keyOf(p) }))
    .sort((a, b) => {
      if (a.key === null || b.key === null) {
        if (a.key === b.key) return a.i - b.i;
        return a.key === null ? 1 : -1;
      }
      if (a.key < b.key) return -sign;
      if (a.key > b.key) return sign;
      return a.i - b.i;
    })
    .map((x) => x.p);
}
