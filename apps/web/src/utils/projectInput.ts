import type { ProjectStatus } from '@/types/project';

// A change to a project as the web's forms express it: its fields, its teams (the
// ones the viewer can see) and its members (the whole list).
export interface ProjectChange {
  name?: string;
  description?: string;
  content?: string;
  status?: ProjectStatus;
  leadUserId?: string | null;
  priority?: number;
  startDate?: string | null;
  targetDate?: string | null;
  labelIds?: string[];
  teamIds?: string[];
  memberIds?: string[];
}

export interface ProjectInputFields {
  name?: string;
  description?: string;
  content?: string;
  statusId?: string;
  leadId?: string | null;
  priority?: number;
  startDate?: string | null;
  targetDate?: string | null;
  labelIds?: string[];
  teamIds?: string[];
  memberIds?: string[];
}

// Linear's ProjectCreateInput / ProjectUpdateInput for a change: the lead goes as
// leadId and the status as the status's id; fields left undefined are left out.
export function toProjectInput(
  change: ProjectChange,
  statusIds: ReadonlyMap<ProjectStatus, string>,
): ProjectInputFields {
  const { status, leadUserId, ...rest } = change;
  const input: ProjectInputFields = {};
  for (const [key, value] of Object.entries(rest))
    if (value !== undefined) (input as Record<string, unknown>)[key] = value;
  if (leadUserId !== undefined) input.leadId = leadUserId;
  if (status !== undefined) {
    const id = statusIds.get(status);
    if (!id) throw new Error(`No project status id for "${status}"`);
    input.statusId = id;
  }
  return input;
}
