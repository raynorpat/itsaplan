// Linear's progress rule for cycles and projects: completed issues count 1, started
// issues 0.25, canceled issues are left out. Weighted by estimate when any counted
// issue has an estimate above 0 (an issue without an estimate then counts its team's
// `defaultIssueEstimate`), otherwise by issue count. 0 when nothing counts; 0.999 instead of 1 while open
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
  // The issue's team's `default_issue_estimate`, counted when `estimate` is null.
  defaultEstimate: number;
  // The workflow state's type: backlog, unstarted, started, completed, canceled.
  type: string;
}

// The sums the rule needs, so it can be applied to rows or to SQL aggregates.
export interface ProgressTotals {
  // Issues not canceled, completed ones, started ones.
  count: number;
  completedCount: number;
  startedCount: number;
  // Whether any counted issue has an estimate above 0.
  weighted: boolean;
  // Sums of the estimates (an issue without one counts its team's default) of the same
  // three sets.
  weight: number;
  completedWeight: number;
  startedWeight: number;
  // Whether any counted issue is not completed.
  anyOpen: boolean;
}

export function weighTotals(t: ProgressTotals): Progress {
  const scope = t.weighted ? t.weight : t.count;
  const completedScope = t.weighted ? t.completedWeight : t.completedCount;
  const inProgressScope = t.weighted ? t.startedWeight : t.startedCount;
  let progress = scope > 0 ? (completedScope + 0.25 * inProgressScope) / scope : 0;
  if (progress === 1 && t.anyOpen) progress = 0.999;
  return {
    progress,
    issueCount: t.count,
    completedIssueCount: t.completedCount,
    scope,
    completedScope,
    inProgressScope,
  };
}

export function weighProgress(rows: ProgressIssue[]): Progress {
  const counted = rows.filter((r) => r.type !== 'canceled');
  const completed = counted.filter((r) => r.type === 'completed');
  const started = counted.filter((r) => r.type === 'started');
  const sum = (list: ProgressIssue[]) =>
    list.reduce((n, r) => n + (r.estimate ?? r.defaultEstimate), 0);
  return weighTotals({
    count: counted.length,
    completedCount: completed.length,
    startedCount: started.length,
    weighted: counted.some((r) => (r.estimate ?? 0) > 0),
    weight: sum(counted),
    completedWeight: sum(completed),
    startedWeight: sum(started),
    anyOpen: counted.some((r) => r.type !== 'completed'),
  });
}
