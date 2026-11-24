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

// Activity is every issue the viewer is involved in, newest change first.
export function myIssuesFilter(tab: MyIssuesTab): Record<string, unknown> {
  if (tab === 'activity') return { or: [FILTERS.assigned, FILTERS.created, FILTERS.subscribed] };
  return FILTERS[tab];
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
