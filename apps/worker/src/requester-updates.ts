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
// A job still running is not started again: a slow run (many emails, a slow AI endpoint)
// is never overlapped by the next one.
const inFlight = { changes: false, summaries: false };

type Post = (path: string) => Promise<number>;

async function post(path: string): Promise<number> {
  const response = await postInternal(path, {}, 300_000);
  if (!response.ok) throw new Error(`Requester updates API returned ${response.status}`);
  const body = (await response.json()) as { sent?: number };
  return body.sent ?? 0;
}

const JOBS = {
  changes: { path: '/internal/requester-updates/changes', what: 'requester change emails' },
  summaries: { path: '/internal/requester-updates/summaries', what: 'requester summaries' },
} as const;

// Called on every tick, and not awaited there: webhook and notification delivery keep
// their pace while a run goes on. Starts each due job that is not still running and
// returns the started runs (tests wait on them). A failed call is logged and the next
// due tick tries again; an unreachable api must not fail the tick.
export function runRequesterUpdates(nowMs = Date.now(), send: Post = post): Promise<void>[] {
  const due = requesterJobsDue(nowMs, lastRuns);
  const started: Promise<void>[] = [];
  for (const job of ['changes', 'summaries'] as const) {
    if (!due[job] || inFlight[job]) continue;
    lastRuns[job] = nowMs;
    inFlight[job] = true;
    started.push(
      send(JOBS[job].path)
        .then((sent) => {
          if (sent > 0) console.log(`[worker] sent ${sent} ${JOBS[job].what}`);
        })
        .catch((error) => console.error(`[worker] ${JOBS[job].what} failed:`, error))
        .finally(() => {
          inFlight[job] = false;
        }),
    );
  }
  return started;
}
