import type { FeedItem } from '@/types/issue';
import type { FeedEntry } from '@/utils/commentThreads';

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

// The session view's rows. `mergeReplies` false is for a thread's later sessions: the
// first session's view shows the thread's replies, so the others only hide the
// prompts those replies became.
export function sessionTimeline(
  activities: SessionActivity[],
  replies: FeedItem[],
  mergeReplies = true,
): TimelineRow[] {
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
    ...(mergeReplies ? replies : []).map((reply) => ({ at: reply.createdAt, reply })),
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
const isSessionLive = (status: AgentSessionStatus) =>
  status === 'pending' || status === 'active' || status === 'stopping';

// The agent sessions of a comment thread, in order: the root's session, then each
// other session a reply started (an app mentioned in the thread). Linear's
// Comment.agentSession associates a reply with the session it started.
export function threadSessionIds(entry: FeedEntry): string[] {
  const ids: string[] = [];
  for (const item of [entry.item, ...entry.replies])
    if (item.agentSessionId && !ids.includes(item.agentSessionId)) ids.push(item.agentSessionId);
  return ids;
}

const LIVE_REFRESH_MS = 4000;
// A live session that has not changed for this long stops refreshing until the
// window is focused again.
const LIVE_REFRESH_LIMIT_MS = 10 * 60_000;

// How often the session view refreshes: every few seconds while the agent is expected
// to write and the session changed recently, else not at all.
export function pollDelay(
  status: AgentSessionStatus,
  lastChangeAt: number,
  now: number,
): number | false {
  return isSessionLive(status) && now - lastChangeAt < LIVE_REFRESH_LIMIT_MS
    ? LIVE_REFRESH_MS
    : false;
}

const OPEN: AgentSessionStatus[] = ['pending', 'active', 'awaitingInput', 'stopping'];

// The status shown on the issue: its first open session's (sessions newest first), or
// null when none is open.
export function issueSessionStatus(statuses: AgentSessionStatus[]): AgentSessionStatus | null {
  return statuses.find((s) => OPEN.includes(s)) ?? null;
}
