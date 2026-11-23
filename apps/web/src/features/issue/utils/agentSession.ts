import type { FeedItem } from '@/types/issue';

// An agent session as the issue page shows it, from Linear's AgentSession and
// AgentActivity. The session's thread holds the people's replies as comments; the
// agent's work arrives as activities.

export type AgentSessionStatus =
  'pending' | 'active' | 'awaitingInput' | 'complete' | 'error' | 'stopping' | 'stale';

export type ActivityType = 'thought' | 'action' | 'elicitation' | 'response' | 'error' | 'prompt';

export interface SessionActivity {
  id: string;
  createdAt: string;
  type: ActivityType;
  // Markdown for every type except action.
  body: string | null;
  // Action content: what the agent did, on what, and the result.
  action: string | null;
  parameter: string | null;
  result: string | null;
  ephemeral: boolean;
  signal: string | null;
  // The reply comment a prompt was made from, when a person wrote one.
  sourceCommentId: string | null;
  userName: string;
}

// One row of the session view, oldest first: a run of thoughts and actions shown
// collapsed, an agent message (elicitation, response, error), a prompt that has no
// comment of its own (a stop, a repeated delegation), or a person's reply.
export type TimelineRow =
  | { kind: 'steps'; id: string; activities: SessionActivity[] }
  | { kind: 'message'; id: string; activity: SessionActivity }
  | { kind: 'prompt'; id: string; activity: SessionActivity }
  | { kind: 'reply'; id: string; item: FeedItem };

const byTime = (a: { createdAt: string }, b: { createdAt: string }) =>
  a.createdAt.localeCompare(b.createdAt);

export function sessionTimeline(activities: SessionActivity[], replies: FeedItem[]): TimelineRow[] {
  const sorted = [...activities].sort(byTime);
  const latestId = sorted.at(-1)?.id;
  const replyIds = new Set(replies.map((r) => r.id));
  const shown = sorted.filter(
    // An ephemeral activity is replaced by the next one (Linear).
    (a) =>
      (!a.ephemeral || a.id === latestId) &&
      // A reply's prompt is shown as the reply comment itself.
      !(a.type === 'prompt' && a.sourceCommentId && replyIds.has(a.sourceCommentId)),
  );

  const merged: ({ at: string } & ({ activity: SessionActivity } | { reply: FeedItem }))[] = [
    ...shown.map((activity) => ({ at: activity.createdAt, activity })),
    ...replies.map((reply) => ({ at: reply.createdAt, reply })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  const rows: TimelineRow[] = [];
  for (const entry of merged) {
    if ('reply' in entry) {
      rows.push({ kind: 'reply', id: entry.reply.id, item: entry.reply });
      continue;
    }
    const a = entry.activity;
    if (a.type === 'thought' || a.type === 'action') {
      const last = rows.at(-1);
      if (last?.kind === 'steps') last.activities.push(a);
      else rows.push({ kind: 'steps', id: a.id, activities: [a] });
    } else if (a.type === 'prompt') {
      rows.push({ kind: 'prompt', id: a.id, activity: a });
    } else {
      rows.push({ kind: 'message', id: a.id, activity: a });
    }
  }
  return rows;
}

export type StatusTone = 'progress' | 'waiting' | 'done' | 'error' | 'muted';

const STATUS: Record<AgentSessionStatus, { label: string; tone: StatusTone }> = {
  pending: { label: 'Pending', tone: 'muted' },
  active: { label: 'Working', tone: 'progress' },
  awaitingInput: { label: 'Needs input', tone: 'waiting' },
  complete: { label: 'Done', tone: 'done' },
  error: { label: 'Error', tone: 'error' },
  stopping: { label: 'Stopping', tone: 'muted' },
  stale: { label: 'Ended', tone: 'muted' },
};

export const sessionStatus = (status: AgentSessionStatus) => STATUS[status] ?? STATUS.stale;

// The API refuses a stop on a session that has ended or is already stopping.
export const canStopSession = (status: AgentSessionStatus) =>
  status === 'pending' || status === 'active' || status === 'awaitingInput';

// While the agent is expected to write, the session view refreshes every few seconds.
export const isSessionLive = (status: AgentSessionStatus) =>
  status === 'pending' || status === 'active' || status === 'stopping';
