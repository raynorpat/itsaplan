// A project status type (Linear's six project status types).
export type ProjectStatus = 'backlog' | 'planned' | 'started' | 'paused' | 'completed' | 'canceled';

export type ProjectHealth = 'onTrack' | 'atRisk' | 'offTrack';

export interface Project {
  id: string;
  // The project's teams the viewer can access.
  teams: { id: string; key: string; name: string }[];
  name: string;
  // Short plain-text summary.
  description: string;
  // Markdown overview.
  content: string;
  status: ProjectStatus;
  statusId: string;
  leadUserId: string | null;
  // Linear's scale: 0 none, 1 urgent, 2 high, 3 medium, 4 low.
  priority: number;
  startDate: string | null;
  targetDate: string | null;
  sortOrder: number;
  slugId: string;
  archivedAt: string | null;
  // In the trash (deleted, restorable for 30 days); null otherwise.
  trashed: boolean | null;
  createdAt: string;
  updatedAt: string;
  labelIds: string[];
  // Linear's progress, 0–1: completed issues count 1 and started ones a quarter,
  // weighted by estimate when the project's issues have estimates.
  progress: number;
  // The latest project update's health, or null when there is no update.
  health: ProjectHealth | null;
  // Linear's scope: the project's issues that are not canceled, in estimate points
  // when they have estimates.
  scope: number;
}

// Columns the project list can be sorted by (in the browser, over the loaded rows).
// progress and health are derived and not sortable.
export const PROJECT_SORTS = ['name', 'priority', 'targetDate', 'lead'] as const;

export type ProjectSort = (typeof PROJECT_SORTS)[number];

// A project milestone, read from Project.projectMilestones.
export interface ProjectMilestone {
  id: string;
  projectId: string;
  name: string;
  description: string;
  targetDate: string | null;
  sortOrder: number;
}

// Per-status project counts for the list's status tabs.
export type ProjectCounts = Record<ProjectStatus | 'total', number>;
