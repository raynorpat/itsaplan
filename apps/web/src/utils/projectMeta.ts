import type { ProjectStatus, ProjectHealth } from '@/types/project';

// Display metadata for the project status lifecycle and the derived health
// signal. Colors are raw hex so they can drive both a dot and a text color.

export const STATUS_META: Record<ProjectStatus, { label: string; color: string }> = {
  backlog: { label: 'Backlog', color: '#a1a1aa' },
  planned: { label: 'Planned', color: '#6366f1' },
  started: { label: 'In Progress', color: '#eab308' },
  paused: { label: 'Paused', color: '#0f7488' },
  completed: { label: 'Completed', color: '#22c55e' },
  canceled: { label: 'Canceled', color: '#ef4444' },
};

// The lifecycle order used by the status picker and the list tabs.
export const STATUS_ORDER: ProjectStatus[] = [
  'backlog',
  'planned',
  'started',
  'paused',
  'completed',
  'canceled',
];

// The open statuses an issue can be linked to: the lifecycle without the terminal
// completed and canceled, which are not offered in the link pickers.
export const LINKABLE_STATUSES: ProjectStatus[] = ['backlog', 'planned', 'started', 'paused'];

// Health (computed server-side). null means there is nothing to judge yet.
export const HEALTH_META: Record<ProjectHealth, { label: string; color: string }> = {
  onTrack: { label: 'On track', color: '#22c55e' },
  atRisk: { label: 'At risk', color: '#eab308' },
  offTrack: { label: 'Off track', color: '#ef4444' },
};

export function healthMeta(health: ProjectHealth | null): { label: string; color: string } {
  return health ? HEALTH_META[health] : { label: 'No update', color: '#a1a1aa' };
}
