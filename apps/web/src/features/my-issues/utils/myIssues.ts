import type { StateType } from '@/types/team';
import { cycleLabel } from '@/utils/cycles';
import { isDueOverdue } from '@/utils/dates';
import { PRIORITY_ORDER, priorityLabel } from '@/utils/fieldOptions';
import type { GroupField } from '@/utils/viewSettings';
import type { Sort } from '@/utils/viewTypes';
import type { ListRowData } from '@/components/common/board/list/ListRowContent';
import type { MyIssue } from '../services/myIssues.service';

// Linear's "My issues" tabs and the IssueFilter each one asks for.
export type MyIssuesTab = 'assigned' | 'created' | 'subscribed' | 'activity';

export const MY_ISSUES_TABS: { id: MyIssuesTab; label: string }[] = [
  { id: 'assigned', label: 'Assigned' },
  { id: 'created', label: 'Created' },
  { id: 'subscribed', label: 'Subscribed' },
  { id: 'activity', label: 'Activity' },
];

export const isMyIssuesTab = (value: string): value is MyIssuesTab =>
  MY_ISSUES_TABS.some((t) => t.id === value);

const ME = { isMe: { eq: true } };
const FILTERS: Record<Exclude<MyIssuesTab, 'activity'>, Record<string, unknown>> = {
  assigned: { assignee: ME },
  created: { creator: ME },
  subscribed: { subscribers: { some: ME } },
};

const OPEN = { state: { type: { nin: ['completed', 'canceled'] } } };

// The tab's filter. Activity is every issue the viewer is involved in. Without
// `includeCompleted`, completed and canceled issues are left out.
export function myIssuesFilter(
  tab: MyIssuesTab,
  includeCompleted: boolean,
): Record<string, unknown> {
  const base =
    tab === 'activity'
      ? { or: [FILTERS.assigned, FILTERS.created, FILTERS.subscribed] }
      : FILTERS[tab];
  return includeCompleted ? base : { and: [base, OPEN] };
}

// The groupings My issues offers. Its issues span teams, so it groups only by what
// every team shares: the status type, the priority and the project.
export const MY_ISSUES_GROUPS = ['none', 'status', 'priority', 'project'] as const;
export type MyIssuesGroup = (typeof MY_ISSUES_GROUPS)[number];

// The stored grouping as one My issues offers; any other falls back to status.
export function myIssuesGrouping(group: GroupField): MyIssuesGroup {
  return (MY_ISSUES_GROUPS as readonly string[]).includes(group)
    ? (group as MyIssuesGroup)
    : 'status';
}

// The status groups in Linear's list order. Issues from different teams have
// different states, so they are grouped by the state's type.
const TYPE_ORDER = ['triage', 'started', 'unstarted', 'backlog', 'completed', 'canceled'];

const TYPE_LABELS: Record<string, string> = {
  triage: 'Triage',
  started: 'In Progress',
  unstarted: 'Todo',
  backlog: 'Backlog',
  completed: 'Done',
  canceled: 'Canceled',
};

interface GroupableIssue {
  state: { type: string; color?: string };
  priority: number;
  project: { id: string; name: string } | null;
}

export interface MyIssuesGroupData<T> {
  key: string;
  name: string;
  stateType?: StateType;
  // Priority groups, for the priority icon.
  priority?: number;
  color?: string;
  issues: T[];
}

// The issues in groups for the chosen grouping, empty groups left out: status types
// in workflow order, priorities most urgent first with no priority last, projects
// by name with no project last, or one group of every issue ('all').
export function groupMyIssues<T extends GroupableIssue>(
  issues: T[],
  group: MyIssuesGroup,
): MyIssuesGroupData<T>[] {
  const nonEmpty = (groups: MyIssuesGroupData<T>[]) => groups.filter((g) => g.issues.length > 0);
  switch (group) {
    case 'none':
      return [{ key: 'all', name: 'All issues', issues }];
    case 'status':
      return nonEmpty(
        TYPE_ORDER.map((type) => {
          const members = issues.filter((i) => i.state.type === type);
          return {
            key: type,
            name: TYPE_LABELS[type] ?? type,
            stateType: type as StateType,
            color: members[0]?.state.color,
            issues: members,
          };
        }),
      );
    case 'priority':
      return nonEmpty(
        [...PRIORITY_ORDER, 0].map((p) => ({
          key: `p${p}`,
          name: priorityLabel(p),
          priority: p,
          issues: issues.filter((i) => i.priority === p),
        })),
      );
    case 'project': {
      // Keyed by id: projects of different teams may share a name.
      const projects = new Map<string, string>();
      for (const i of issues) if (i.project) projects.set(i.project.id, i.project.name);
      const ordered = [...projects.entries()].sort((a, b) =>
        a[1].localeCompare(b[1], undefined, { sensitivity: 'base' }),
      );
      return nonEmpty(
        [...ordered, ['', 'No project'] as const].map(([id, name]) => ({
          key: `project:${id}`,
          name,
          issues: issues.filter((i) => (i.project?.id ?? '') === id),
        })),
      );
    }
  }
}

// The most issues My issues loads to order or group the whole set.
export const MY_ISSUES_CAP = 1000;

// How My issues loads its issues. The server returns them by the time of the last
// change, so that order (and the Activity tab) pages on request; any other ordering
// or a grouping needs the whole set, as Linear orders and groups it, loaded up to
// MY_ISSUES_CAP.
export function myIssuesLoadMode(
  tab: MyIssuesTab,
  display: { sort: Sort; group: GroupField },
): 'paged' | 'all' {
  if (tab === 'activity') return 'paged';
  const { field, dir } = myIssuesSort(display.sort);
  const serverOrder = field === 'updated' && dir === 'desc';
  return serverOrder && myIssuesGrouping(display.group) === 'none' ? 'paged' : 'all';
}

// Whether to load the next page now: always for the whole set, and while paging
// when no loaded issue is shown (all filtered out by the Completed issues window or
// Show sub-issues), so the list never reads "No issues" while more exist.
export function shouldLoadMore(s: {
  mode: 'paged' | 'all';
  hasNextPage: boolean;
  fetching: boolean;
  loaded: number;
  visible: number;
}): boolean {
  if (!s.hasNextPage || s.fetching || s.loaded >= MY_ISSUES_CAP) return false;
  return s.mode === 'all' || s.visible === 0;
}

// The ordering My issues applies. Its issues span teams, which have no shared manual
// order, so the default (manual) reads as the newest change first.
export function myIssuesSort(sort: Sort): Sort {
  return sort.field === 'manual' ? { field: 'updated', dir: 'desc' } : sort;
}

interface SortableIssue {
  title: string;
  identifier: string;
  priority: number;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
  state: { type: string };
  assignee: { name: string } | null;
}

// Returns a new array in the chosen order. Missing values (no due date, no assignee)
// sort last in both directions, as on a team's list; ties keep the loaded order.
export function sortMyIssues<T extends SortableIssue>(issues: T[], sort: Sort): T[] {
  const { field, dir } = myIssuesSort(sort);
  const sign = dir === 'desc' ? -1 : 1;
  const key = (i: T): number | string | null => {
    switch (field) {
      case 'title':
        return i.title;
      case 'identifier':
        return i.identifier;
      case 'status': {
        const index = TYPE_ORDER.indexOf(i.state.type);
        return index === -1 ? TYPE_ORDER.length : index;
      }
      case 'priority':
        return i.priority === 0 ? 5 : i.priority;
      case 'assignee':
        return i.assignee?.name ?? null;
      case 'dueDate':
        return i.dueDate;
      case 'created':
        return i.createdAt;
      default:
        return i.updatedAt;
    }
  };
  return [...issues].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (ka === kb) return 0;
    if (ka == null || ka === '') return 1;
    if (kb == null || kb === '') return -1;
    const cmp =
      typeof ka === 'number' && typeof kb === 'number'
        ? ka - kb
        : String(ka).localeCompare(String(kb), undefined, { numeric: true, sensitivity: 'base' });
    return cmp * sign;
  });
}

// A My issues issue as a row of the shared list. The identifier (KEY-N) names the
// issue's team, so lists that span teams need no separate team column.
export function myIssueRow(issue: MyIssue): ListRowData {
  const type = issue.state.type as StateType;
  const avatar = (p: MyIssue['assignee']) => (p ? { name: p.name, image: p.avatarUrl } : null);
  return {
    priority: issue.priority,
    identifier: issue.identifier,
    title: issue.title,
    state: { type, color: issue.state.color, name: issue.state.name },
    labels: issue.labels,
    project: issue.project?.name ?? null,
    cycle: issue.cycle ? cycleLabel(issue.cycle) : null,
    dueDate: issue.dueDate
      ? { date: issue.dueDate, overdue: isDueOverdue(issue.dueDate, type) }
      : null,
    assignee: avatar(issue.assignee),
    delegate: avatar(issue.delegate),
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
  };
}
