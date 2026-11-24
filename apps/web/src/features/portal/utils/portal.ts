// Display helpers for the portal pages. `PortalIssue` mirrors the API's
// /portal/boards/:slug/issues rows.

export type PublicStatus = 'planned' | 'inProgress' | 'done';

export interface PortalIssue {
  identifier: string;
  title: string;
  status: PublicStatus;
  votes: number;
  comments: number;
  voted: boolean;
  underReview: boolean;
}

export const PUBLIC_STATUSES: PublicStatus[] = ['planned', 'inProgress', 'done'];

const STATUS_LABEL: Record<PublicStatus, 'Planned' | 'In progress' | 'Done'> = {
  planned: 'Planned',
  inProgress: 'In progress',
  done: 'Done',
};

export function statusLabel(status: PublicStatus): 'Planned' | 'In progress' | 'Done' {
  return STATUS_LABEL[status];
}

export function voteLabel(n: number): string {
  return n === 1 ? '1 vote' : `${n} votes`;
}

// The roadmap's three columns, keeping the list's order. Suggestions under review are
// the visitor's own and not on the board yet, so they stay off the roadmap.
export function roadmapColumns(issues: PortalIssue[]): Record<PublicStatus, PortalIssue[]> {
  const columns: Record<PublicStatus, PortalIssue[]> = { planned: [], inProgress: [], done: [] };
  for (const issue of issues) if (!issue.underReview) columns[issue.status].push(issue);
  return columns;
}

// The issue as it reads right after the visitor (un)votes, until the API answers with
// the real count.
export function optimisticVote(issue: PortalIssue, voted: boolean): PortalIssue {
  if (issue.voted === voted) return issue;
  return { ...issue, voted, votes: Math.max(0, issue.votes + (voted ? 1 : -1)) };
}
