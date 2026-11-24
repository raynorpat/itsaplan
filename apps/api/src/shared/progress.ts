// Linear's progress rule for cycles and projects: completed issues count 1, started
// issues 0.25, canceled issues are left out. Weighted by estimate when any counted
// issue has an estimate above 0 (an issue without an estimate then counts 1),
// otherwise by issue count. 0 when nothing counts; 0.999 instead of 1 while open
// issues with a zero estimate remain.

export interface Progress {
  progress: number;
  issueCount: number;
  completedIssueCount: number;
  scope: number;
  completedScope: number;
  inProgressScope: number;
}

export interface ProgressIssue {
  estimate: number | null;
  // The workflow state's type: backlog, unstarted, started, completed, canceled.
  type: string;
}

export function weighProgress(rows: ProgressIssue[]): Progress {
  const counted = rows.filter((r) => r.type !== 'canceled');
  const weighted = counted.some((r) => (r.estimate ?? 0) > 0);
  const weight = (r: ProgressIssue) => (weighted ? (r.estimate ?? 1) : 1);
  const sum = (list: ProgressIssue[]) => list.reduce((n, r) => n + weight(r), 0);
  const completed = counted.filter((r) => r.type === 'completed');
  const started = counted.filter((r) => r.type === 'started');
  const scope = sum(counted);
  let progress = scope > 0 ? (sum(completed) + 0.25 * sum(started)) / scope : 0;
  if (progress === 1 && counted.some((r) => r.type !== 'completed')) progress = 0.999;
  return {
    progress,
    issueCount: counted.length,
    completedIssueCount: completed.length,
    scope,
    completedScope: sum(completed),
    inProgressScope: sum(started),
  };
}
