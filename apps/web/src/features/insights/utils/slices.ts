import type { Issue } from '@/types/issue';
import type { FilterCondition } from '@/utils/filters';
import { PRIORITY_ORDER, priorityLabel } from '@/utils/fieldOptions';

// The fields of an issue the Insights panel reads. A board issue has all of them;
// the completed issues the panel fetches carry only these.
export type InsightIssue = Pick<
  Issue,
  | 'id'
  | 'teamId'
  | 'identifier'
  | 'title'
  | 'stateId'
  | 'assigneeUserId'
  | 'creatorUserId'
  | 'priority'
  | 'estimate'
  | 'labelIds'
  | 'project'
  | 'cycleId'
  | 'startedAt'
  | 'completedAt'
  | 'canceledAt'
  | 'createdAt'
>;

// Names the panel shows for the ids on an issue.
export interface InsightsContext {
  states: ReadonlyMap<string, { name: string; type: string; position: number }>;
  users: ReadonlyMap<string, string>;
  labels: ReadonlyMap<string, string>;
  cycles: ReadonlyMap<string, string>;
  teams: ReadonlyMap<string, string>;
}

export type SliceField =
  'status' | 'assignee' | 'priority' | 'label' | 'project' | 'cycle' | 'creator' | 'team';

export interface Slice {
  key: string;
  label: string;
  issues: InsightIssue[];
}

// The key of the slice for issues with no value (no assignee, label, project, …).
export const NONE = 'none';

const NONE_LABEL: Record<SliceField, string> = {
  status: 'Unknown status',
  assignee: 'Unassigned',
  priority: 'No priority',
  label: 'No label',
  project: 'No project',
  cycle: 'No cycle',
  creator: 'No creator',
  team: 'Unknown team',
};

// The slice keys of one issue for a field: one key, or one per label.
function keysOf(issue: InsightIssue, field: SliceField): string[] {
  switch (field) {
    case 'status':
      return [issue.stateId];
    case 'assignee':
      return [issue.assigneeUserId ?? NONE];
    case 'priority':
      return [String(issue.priority || 0)];
    case 'label':
      return issue.labelIds.length ? issue.labelIds : [NONE];
    case 'project':
      return [issue.project?.id ?? NONE];
    case 'cycle':
      return [issue.cycleId ?? NONE];
    case 'creator':
      return [issue.creatorUserId ?? NONE];
    case 'team':
      return [issue.teamId];
  }
}

function labelOf(field: SliceField, key: string, sample: InsightIssue, ctx: InsightsContext) {
  if (key === NONE) return NONE_LABEL[field];
  switch (field) {
    case 'status':
      return ctx.states.get(key)?.name ?? NONE_LABEL.status;
    case 'assignee':
    case 'creator':
      return ctx.users.get(key) ?? 'Unknown user';
    case 'priority':
      return priorityLabel(Number(key));
    case 'label':
      return ctx.labels.get(key) ?? 'Unknown label';
    case 'project':
      return sample.project?.deleted
        ? `${sample.project.title} (deleted)`
        : (sample.project?.title ?? key);
    case 'cycle':
      return ctx.cycles.get(key) ?? 'Unknown cycle';
    case 'team':
      return ctx.teams.get(key) ?? NONE_LABEL.team;
  }
}

// The rank of a slice in its natural order: workflow position for status, Urgent to
// Low then No priority for priority, the name for the rest; the "none" slice last.
function rank(field: SliceField, slice: Slice, ctx: InsightsContext): number | string {
  if (field === 'status') return ctx.states.get(slice.key)?.position ?? Number.MAX_SAFE_INTEGER;
  if (field === 'priority') {
    const i = PRIORITY_ORDER.indexOf(Number(slice.key) as (typeof PRIORITY_ORDER)[number]);
    return i === -1 ? PRIORITY_ORDER.length : i;
  }
  return slice.label.toLocaleLowerCase();
}

// Groups issues by one field in its natural order. An issue with several labels is
// in each label's slice. Only slices that hold issues are returned.
export function sliceIssues(
  issues: InsightIssue[],
  field: SliceField,
  ctx: InsightsContext,
): Slice[] {
  const byKey = new Map<string, Slice>();
  for (const issue of issues) {
    for (const key of keysOf(issue, field)) {
      let slice = byKey.get(key);
      if (!slice) {
        slice = { key, label: labelOf(field, key, issue, ctx), issues: [] };
        byKey.set(key, slice);
      }
      slice.issues.push(issue);
    }
  }
  return [...byKey.values()].sort((a, b) => {
    if ((a.key === NONE) !== (b.key === NONE)) return a.key === NONE ? 1 : -1;
    const ra = rank(field, a, ctx);
    const rb = rank(field, b, ctx);
    if (typeof ra === 'number' && typeof rb === 'number') return ra - rb;
    return String(ra).localeCompare(String(rb));
  });
}

// The view filter condition that narrows a view to one slice (clicking a bar), or
// null for a field the view filter has no condition for (project, creator, team).
export function sliceFilter(field: SliceField, key: string): FilterCondition | null {
  const value = key === NONE ? null : key;
  const condition = (filterField: string, values: FilterCondition['values']) => ({
    id: `insights-${filterField}`,
    field: filterField,
    op: 'is' as const,
    values,
  });
  switch (field) {
    case 'status':
      return condition('status', [key]);
    case 'assignee':
      return condition('assignee', [value]);
    case 'priority':
      return condition('priority', [Number(key) || null]);
    case 'label':
      return condition('labels', [value]);
    case 'cycle':
      return condition('cycle', [value]);
    case 'project':
    case 'creator':
    case 'team':
      return null;
  }
}
