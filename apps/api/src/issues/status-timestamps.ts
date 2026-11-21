// Linear's status timestamps on an issue, kept in step with the type of the column
// the issue is in. Applied on create and on every column change.

export type StateType = 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled';

export interface StatusTimestamps {
  startedAt: Date | null;
  completedAt: Date | null;
  canceledAt: Date | null;
}

// The timestamps after the issue enters a column of type `toType` at `now`:
// started sets startedAt once; completed and canceled each set their own and clear
// the other; backlog and unstarted clear all three.
export function nextStatusTimestamps(
  prev: StatusTimestamps,
  toType: StateType,
  now: Date,
): StatusTimestamps {
  switch (toType) {
    case 'backlog':
    case 'unstarted':
      return { startedAt: null, completedAt: null, canceledAt: null };
    case 'started':
      return { startedAt: prev.startedAt ?? now, completedAt: null, canceledAt: null };
    case 'completed':
      return { startedAt: prev.startedAt, completedAt: now, canceledAt: null };
    case 'canceled':
      return { startedAt: prev.startedAt, completedAt: null, canceledAt: now };
  }
}
