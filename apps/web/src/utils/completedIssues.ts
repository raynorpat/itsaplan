// Which closed issues a board shows (Linear's showCompletedIssues): all of them,
// none, or those completed or canceled within the past week or month. Open issues
// always show. Sub-issues can be hidden separately (Linear's showSubIssues).
export type CompletedWindow = 'all' | 'week' | 'month' | 'none';

export const COMPLETED_WINDOWS: { value: CompletedWindow; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'week', label: 'Past week' },
  { value: 'month', label: 'Past month' },
  { value: 'none', label: 'None' },
];

const WINDOW_DAYS: Record<'week' | 'month', number> = { week: 7, month: 30 };
const DAY_MS = 86_400_000;

interface ClosableIssue {
  completedAt: string | null;
  canceledAt: string | null;
  parentId: string | null;
}

export function visibleIssues<T extends ClosableIssue>(
  issues: T[],
  options: { completedIssues: CompletedWindow; showSubIssues: boolean },
  now: Date,
): T[] {
  const { completedIssues, showSubIssues } = options;
  if (completedIssues === 'all' && showSubIssues) return issues;
  const since =
    completedIssues === 'week' || completedIssues === 'month'
      ? now.getTime() - WINDOW_DAYS[completedIssues] * DAY_MS
      : null;
  return issues.filter((issue) => {
    if (!showSubIssues && issue.parentId) return false;
    const closedAt = issue.completedAt ?? issue.canceledAt;
    if (!closedAt || completedIssues === 'all') return true;
    if (completedIssues === 'none') return false;
    return new Date(closedAt).getTime() >= (since ?? 0);
  });
}
