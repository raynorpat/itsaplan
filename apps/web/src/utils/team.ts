// Grouping, sorting and drop-position helpers shared by the team views (Team,
// Table, Timeline, Calendar) so they bucket and order issues the same way. Date
// and avatar helpers live in lib/dates and lib/avatar.

import type {
  Assignee,
  TeamDetail,
  Column,
  Label,
  StateType,
  Issue,
  IssuePatch,
  NewIssueInput,
} from '@/lib/api';
import { PRIORITIES } from '@/utils/fieldOptions';
import type { GroupField, ViewSettings } from '@/utils/viewSettings';
import type { Sort } from '@/utils/viewTypes';

export type { Sort, SortField } from '@/utils/viewTypes';

export type NewIssueDefaults = Pick<
  NewIssueInput,
  'stateId' | 'projectId' | 'assigneeUserId' | 'delegateUserId' | 'priority'
>;

// Fallback dot/bar color for a group or issue whose status has no color.
export const DEFAULT_COLOR = '#6b7280';

// Every display mode (Team, Table, Timeline, Calendar) takes the same props, so
// App can render whichever one is selected without special-casing. `settings`
// are the active team+view's display settings (see lib/viewSettings).
export interface WorkItemsViewProps {
  team: TeamDetail;
  settings: ViewSettings;
  // Persist a settings change (used by the flat team to store hidden columns in
  // the view's display). Routes through the view editor: on a saved view it
  // starts an edit (saved on Save), on the All tab it writes localStorage.
  onSettingsChange: (settings: ViewSettings) => void;
  onOpenIssue: (id: string) => void;
  onAddIssue: (defaults: NewIssueDefaults) => void;
  // When true the view is a public read-only share: dragging, adding issues and
  // multi-select are disabled, but opening an issue (onOpenIssue) still works.
  // Defaults to false (the normal authenticated board).
  readOnly?: boolean;
}

// Lookup maps over a team's reference data, built once per render and shared by
// every column/row/cell so each render is a map get instead of an array find.
export interface Maps {
  labelById: Map<string, Label>;
  assigneeById: Map<string, Assignee>;
  columnById: Map<string, Column>;
}

export function buildMaps(team: TeamDetail): Maps {
  return {
    labelById: new Map(team.labels.map((l) => [l.id, l])),
    assigneeById: new Map(team.assignees.map((a) => [a.userId, a])),
    columnById: new Map(team.states.map((c) => [c.id, c])),
  };
}

// The status color of a issue (its column's color), or the neutral default.
export function issueColor(issue: Issue, maps: Maps): string {
  return maps.columnById.get(issue.stateId)?.color ?? DEFAULT_COLOR;
}

// Returns a new array sorted by the chosen field. Missing values (no assignee,
// no due date, …) always sort last, regardless of direction, matching Linear.
// Ties fall back to the manual position so the order is stable. 'manual' returns
// the input unchanged (already position-ordered by the API).
export function sortIssues(issues: Issue[], sort: Sort, team: TeamDetail): Issue[] {
  if (sort.field === 'manual') return issues;

  const columnIndex = new Map(team.states.map((c, i) => [c.id, i]));
  const assigneeName = new Map(team.assignees.map((a) => [a.userId, a.name]));
  const dir = sort.dir === 'desc' ? -1 : 1;

  const numericField =
    sort.field === 'identifier' || sort.field === 'status' || sort.field === 'priority';

  const numKey = (t: Issue): number => {
    switch (sort.field) {
      case 'identifier':
        return Number(t.identifier.split('-').pop()) || 0;
      case 'status':
        return columnIndex.get(t.stateId) ?? Number.POSITIVE_INFINITY;
      case 'priority':
        return t.priority === 0 ? 5 : t.priority;
      default:
        return 0;
    }
  };

  const strKey = (t: Issue): string | null => {
    switch (sort.field) {
      case 'title':
        return t.title;
      case 'assignee':
        return t.assigneeUserId != null ? (assigneeName.get(t.assigneeUserId) ?? '') : null;
      case 'startDate':
        return t.startDate;
      case 'dueDate':
        return t.dueDate;
      case 'created':
        return t.createdAt;
      case 'updated':
        return t.updatedAt;
      default:
        return null;
    }
  };

  return [...issues].sort((a, b) => {
    let cmp: number;
    if (numericField) {
      cmp = numKey(a) - numKey(b);
    } else {
      const sa = strKey(a);
      const sb = strKey(b);
      if (!sa && !sb) cmp = 0;
      else if (!sa)
        return 1; // missing value last, unaffected by direction
      else if (!sb) return -1;
      else cmp = sa.localeCompare(sb, undefined, { numeric: true, sensitivity: 'base' });
    }
    if (cmp === 0) return a.position - b.position;
    return cmp * dir;
  });
}

// Position of a issue dropped at `index` within `issuesInColumn` — the
// midpoint of its new neighbors, so inserting never requires renumbering the
// rest of the column (the same fractional-index trick Linear's sortOrder uses).
export function positionAt(issuesInColumn: Issue[], index: number): number {
  const before = issuesInColumn[index - 1]?.position;
  const at = issuesInColumn[index]?.position;
  if (before == null && at == null) return 1000;
  if (before == null) return at! - 1000;
  if (at == null) return before + 1000;
  return (before + at) / 2;
}

// Groups a team's issues by column id, preserving each column's ordering. The
// map always has an (empty) entry for every column id in `stateIds`.
export function groupByColumn(stateIds: string[], issues: Issue[]): Map<string, Issue[]> {
  const byColumn = new Map<string, Issue[]>();
  for (const id of stateIds) byColumn.set(id, []);
  for (const issue of issues) byColumn.get(issue.stateId)?.push(issue);
  return byColumn;
}

// One Team column / Table section when grouping by the chosen field. `key` is a
// stable id (field-prefixed so different groupings never collide). `assign` is
// the patch that reassigns a issue dropped into this group; it is null for the
// single 'none' group, which is not a drop target.
export interface IssueGroup {
  key: string;
  name: string;
  color?: string;
  stateType?: StateType; // status groups, for the state icon
  assign: IssuePatch | null;
}

// The groups for a team under the chosen grouping field, in display order.
// Includes a trailing "No …" group for the nullable fields so an unset issue
// still has a home (and a drop target that clears the field).
export function buildGroups(team: TeamDetail, group: GroupField): IssueGroup[] {
  switch (group) {
    case 'status':
      return team.states.map((c) => ({
        key: `c${c.id}`,
        name: c.name,
        color: c.color,
        stateType: c.stateType,
        assign: { stateId: c.id },
      }));
    case 'assignee':
      return [
        ...team.assignees
          .filter((a) => a.kind === 'member')
          .map((a) => ({
            key: `a${a.userId}`,
            name: a.name,
            assign: { assigneeUserId: a.userId },
          })),
        { key: 'a-none', name: 'No assignee', assign: { assigneeUserId: null } },
      ];
    case 'delegate':
      return [
        ...team.assignees
          .filter((a) => a.kind === 'agent')
          .map((a) => ({
            key: `d${a.userId}`,
            name: a.name,
            assign: { delegateUserId: a.userId },
          })),
        { key: 'd-none', name: 'No delegate', assign: { delegateUserId: null } },
      ];
    case 'priority':
      return [
        ...PRIORITIES.map((p) => ({
          key: `p${p.value}`,
          name: p.label,
          assign: { priority: p.value },
        })),
        { key: 'p-none', name: 'No priority', assign: { priority: 0 } },
      ];
    case 'project': {
      // Lanes come from the projects the loaded issues are linked to (each issue
      // carries its project). Projects with no issue on the board get no lane;
      // the full list is fetched on demand only where a picker needs it.
      const seen = new Map<string, string>();
      for (const issue of team.issues)
        if (issue.project) seen.set(issue.project.id, issue.project.title);
      const options = [...seen.entries()]
        .sort((a, b) => a[1].localeCompare(b[1]))
        .map(([id, title]) => ({ key: `i${id}`, name: title, assign: { projectId: id } }));
      return [...options, { key: 'i-none', name: 'No project', assign: { projectId: null } }];
    }
    case 'none':
      return [{ key: 'all', name: '', assign: null }];
  }
}

// The group key a issue belongs to under the chosen field — matches a key from
// buildGroups(team, group).
export function groupKeyOf(issue: Issue, group: GroupField): string {
  switch (group) {
    case 'status':
      return `c${issue.stateId}`;
    case 'assignee':
      return issue.assigneeUserId != null ? `a${issue.assigneeUserId}` : 'a-none';
    case 'delegate':
      return issue.delegateUserId != null ? `d${issue.delegateUserId}` : 'd-none';
    case 'priority':
      return issue.priority ? `p${issue.priority}` : 'p-none';
    case 'project':
      return issue.project != null ? `i${issue.project.id}` : 'i-none';
    case 'none':
      return 'all';
  }
}

// Issues bucketed by group key, preserving order. The map always has an (empty)
// entry for every group in `groups`; a issue whose key is not among them (only
// possible if the team data is inconsistent) is dropped.
export function groupIssues(
  groups: IssueGroup[],
  issues: Issue[],
  group: GroupField,
): Map<string, Issue[]> {
  const byGroup = new Map<string, Issue[]>();
  for (const g of groups) byGroup.set(g.key, []);
  for (const issue of issues) byGroup.get(groupKeyOf(issue, group))?.push(issue);
  return byGroup;
}

// Issues bucketed two levels deep: subgroup key -> group key -> issues, order
// preserved. Every subgroup/group cell from the inputs gets an (empty) entry, so
// callers can iterate `subgroups` x `groups` without missing-key checks. Used by
// the swimlane Team and the sub-sectioned Table.
export function nestIssues(
  subgroups: IssueGroup[],
  groups: IssueGroup[],
  issues: Issue[],
  subgroup: GroupField,
  group: GroupField,
): Map<string, Map<string, Issue[]>> {
  const out = new Map<string, Map<string, Issue[]>>();
  for (const sg of subgroups) {
    const inner = new Map<string, Issue[]>();
    for (const g of groups) inner.set(g.key, []);
    out.set(sg.key, inner);
  }
  for (const issue of issues) {
    out.get(groupKeyOf(issue, subgroup))?.get(groupKeyOf(issue, group))?.push(issue);
  }
  return out;
}

// The patch that reassigns a issue dropped into a two-level cell: the primary
// group's assign combined with the sub-group's assign. Either may be null (the
// 'none' group / a Table with no sub-grouping), in which case only the other
// applies; both null means the cell is not a drop target.
export function mergeAssign(a: IssuePatch | null, b: IssuePatch | null): IssuePatch | null {
  if (!a) return b;
  if (!b) return a;
  return { ...a, ...b };
}
