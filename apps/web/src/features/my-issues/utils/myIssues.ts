import type { StateType } from '@/types/team';
import { cycleLabel } from '@/utils/cycles';
import { isDueOverdue } from '@/utils/dates';
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

// Whether a tab first shows completed and canceled issues. Assigned and Subscribed
// show them under their own status groups; Created and Activity, which build up over
// time, start with the open issues only.
export function defaultIncludeCompleted(tab: MyIssuesTab): boolean {
  return tab === 'assigned' || tab === 'subscribed';
}

// The status groups in Linear's list order. Issues from different teams have
// different states, so they are grouped by the state's type.
const TYPE_ORDER = ['triage', 'started', 'unstarted', 'backlog', 'completed', 'canceled'];

export function groupByStateType<T extends { state: { type: string } }>(
  issues: T[],
): { type: string; issues: T[] }[] {
  return TYPE_ORDER.map((type) => ({
    type,
    issues: issues.filter((i) => i.state.type === type),
  })).filter((g) => g.issues.length > 0);
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
