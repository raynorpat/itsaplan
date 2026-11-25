// An issue as the release page lists it.
export interface ReleaseIssue {
  id: string;
  identifier: string;
  title: string;
  teamKey: string;
  number: number;
  state: { name: string; type: string; color: string };
}

export interface ReleaseIssueGroup {
  type: string;
  label: string;
  issues: ReleaseIssue[];
}

const GROUPS: { type: string; label: string }[] = [
  { type: 'triage', label: 'Triage' },
  { type: 'backlog', label: 'Backlog' },
  { type: 'unstarted', label: 'Todo' },
  { type: 'started', label: 'In progress' },
  { type: 'completed', label: 'Done' },
  { type: 'canceled', label: 'Canceled' },
];

// A release's issues grouped by their state's type, in workflow order, without empty
// groups. Issues keep their order within a group.
export function groupIssuesByState(issues: ReleaseIssue[]): ReleaseIssueGroup[] {
  return GROUPS.map((g) => ({
    ...g,
    issues: issues.filter((i) => i.state.type === g.type),
  })).filter((g) => g.issues.length > 0);
}
