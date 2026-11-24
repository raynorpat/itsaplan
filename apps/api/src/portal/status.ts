// The status a portal visitor sees for an issue, from its state type. Team state names
// are never shown. Triage issues (not accepted by the team yet), canceled issues, and
// completed ones more than DONE_DAYS after their completion, are not shown at all
// (null).

export type PublicStatus = 'planned' | 'inProgress' | 'done';

export const DONE_DAYS = 30;
const DAY_MS = 86_400_000;

export function publicStatus(
  stateType: string,
  completedAt: Date | null,
  now: Date,
): PublicStatus | null {
  switch (stateType) {
    case 'backlog':
    case 'unstarted':
      return 'planned';
    case 'started':
      return 'inProgress';
    case 'completed':
      return completedAt && now.getTime() - completedAt.getTime() <= DONE_DAYS * DAY_MS
        ? 'done'
        : null;
    default:
      return null;
  }
}
