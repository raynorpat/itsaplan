// The six project statuses seeded by the baseline migration, one per Linear status
// type, with fixed ids so code and seed agree. Names and colors follow Linear's
// defaults. New projects start in Backlog.
export const PROJECT_STATUSES = [
  {
    id: '9b5c5b6e-1f1a-4c39-9b1a-000000000001',
    type: 'backlog',
    name: 'Backlog',
    color: '#bec2c8',
    position: 0,
  },
  {
    id: '9b5c5b6e-1f1a-4c39-9b1a-000000000002',
    type: 'planned',
    name: 'Planned',
    color: '#e2e2e2',
    position: 1,
  },
  {
    id: '9b5c5b6e-1f1a-4c39-9b1a-000000000003',
    type: 'started',
    name: 'In Progress',
    color: '#f2c94c',
    position: 2,
  },
  {
    id: '9b5c5b6e-1f1a-4c39-9b1a-000000000004',
    type: 'paused',
    name: 'Paused',
    color: '#0f7488',
    position: 3,
  },
  {
    id: '9b5c5b6e-1f1a-4c39-9b1a-000000000005',
    type: 'completed',
    name: 'Completed',
    color: '#5e6ad2',
    position: 4,
  },
  {
    id: '9b5c5b6e-1f1a-4c39-9b1a-000000000006',
    type: 'canceled',
    name: 'Canceled',
    color: '#95a2b3',
    position: 5,
  },
] as const;

export type ProjectStatusType = (typeof PROJECT_STATUSES)[number]['type'];

export const PROJECT_STATUS_IDS = Object.fromEntries(
  PROJECT_STATUSES.map((s) => [s.type, s.id]),
) as Record<ProjectStatusType, string>;
