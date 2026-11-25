import { postInternal } from './internal-api';

// Requester email updates (feedback project 4): the API reads what changed and sends;
// the worker only decides when to ask. Change emails every 2 minutes, summaries every
// 15 minutes (a summary is due from 08:00 UTC, so a quarter-hour late at most).

const CHANGES_EVERY_MS = 2 * 60_000;
const SUMMARIES_EVERY_MS = 15 * 60_000;

export interface RequesterJobRuns {
  changes: number | null;
  summaries: number | null;
}

// Which of the two jobs are due at `nowMs`, given when each last ran (null: never).
export function requesterJobsDue(
  nowMs: number,
  last: RequesterJobRuns,
): { changes: boolean; summaries: boolean } {
  return {
    changes: last.changes === null || nowMs - last.changes >= CHANGES_EVERY_MS,
    summaries: last.summaries === null || nowMs - last.summaries >= SUMMARIES_EVERY_MS,
  };
}

const lastRuns: RequesterJobRuns = { changes: null, summaries: null };

async function post(path: string): Promise<number> {
  const response = await postInternal(path, {}, 300_000);
  if (!response.ok) throw new Error(`Requester updates API returned ${response.status}`);
  const body = (await response.json()) as { sent?: number };
  return body.sent ?? 0;
}

// Called on every tick. A failed call is logged and the next due tick tries again; an
// unreachable api must not fail the tick.
export async function runRequesterUpdates(nowMs = Date.now()): Promise<void> {
  const due = requesterJobsDue(nowMs, lastRuns);
  if (due.changes) {
    lastRuns.changes = nowMs;
    try {
      const sent = await post('/internal/requester-updates/changes');
      if (sent > 0) console.log(`[worker] sent ${sent} requester change emails`);
    } catch (error) {
      console.error('[worker] requester change emails failed:', error);
    }
  }
  if (due.summaries) {
    lastRuns.summaries = nowMs;
    try {
      const sent = await post('/internal/requester-updates/summaries');
      if (sent > 0) console.log(`[worker] sent ${sent} requester summaries`);
    } catch (error) {
      console.error('[worker] requester summaries failed:', error);
    }
  }
}
