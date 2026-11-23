// Linear's agent session lifecycle (AgentSessionStatus), as the SDL describes it:
// thoughts and actions report ongoing work, an elicitation waits for the user, a
// response completes the turn unless it carries the `continue` signal, and an error
// records a failed turn. A person's prompt starts a new turn that the agent has not
// acknowledged yet (`pending`); a prompt with the `stop` signal asks it to stop.

export const SESSION_STATUSES = [
  'pending',
  'active',
  'stopping',
  'awaitingInput',
  'complete',
  'error',
  'stale',
] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const ACTIVITY_TYPES = [
  'thought',
  'action',
  'elicitation',
  'response',
  'error',
  'prompt',
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

// The statuses in which a session is still running a turn or waiting on one.
export const OPEN_STATUSES: SessionStatus[] = ['pending', 'active', 'awaitingInput', 'stopping'];

// The session status after an activity of this type (and signal) is published.
export function sessionStatusAfter(
  _from: SessionStatus,
  activity: { type: ActivityType; signal?: string | null },
): SessionStatus {
  switch (activity.type) {
    case 'thought':
    case 'action':
      return 'active';
    case 'elicitation':
      return 'awaitingInput';
    case 'response':
      return activity.signal === 'continue' ? 'active' : 'complete';
    case 'error':
      return 'error';
    case 'prompt':
      return activity.signal === 'stop' ? 'stopping' : 'pending';
  }
}
