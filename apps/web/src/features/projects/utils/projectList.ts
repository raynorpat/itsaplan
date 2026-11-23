import type { ProjectCounts, ProjectStatus } from '@/types/project';

const STATUSES: ProjectStatus[] = [
  'backlog',
  'planned',
  'started',
  'paused',
  'completed',
  'canceled',
];

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
