import type { ProjectStatus } from '@/lib/api';

export interface ProjectListFilters {
  // A team key; projects with no team the viewer can see are never listed.
  teamKey?: string | null;
  statuses?: ProjectStatus[];
  search?: string;
}

// The list filters as Linear's ProjectFilter: the team through accessibleTeams, the
// statuses by status type, the search as a case-insensitive name match. A blank
// search and an empty status list constrain nothing.
export function toProjectFilter(filters: ProjectListFilters): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (filters.teamKey) out.accessibleTeams = { some: { key: { eq: filters.teamKey } } };
  if (filters.statuses && filters.statuses.length) out.status = { type: { in: filters.statuses } };
  const search = filters.search?.trim();
  if (search) out.name = { containsIgnoreCase: search };
  return out;
}
