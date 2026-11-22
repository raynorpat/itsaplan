import { workerConfig } from './config';
import { deliver, nextRetryDelayS, renderBody } from './delivery';
import { resolvesToPrivate } from './public-host';
import { processNotificationDeliveries } from './notification-delivery';
import { deleteIssueAgentThreads } from './agent-runs';
import { notifyIssuesArchived, runCycleUpkeep } from './internal-api';
import { startPollLoop, type WorkerHandle } from './poll-loop';
import {
  type ClaimedDelivery,
  claimDueDeliveries,
  markSuccess,
  scheduleRetry,
  markFailed,
  markSkippedInactive,
  cleanupOldDeliveries,
  archiveStaleIssues,
} from './store';

let ticksSinceCleanup = 0;
let ticksSinceAutoArchive = 0;
let ticksSinceCycleUpkeep = 0;

export function startWorker(): WorkerHandle {
  return startPollLoop('worker', tick, () => workerConfig().pollIntervalMs);
}

// One poll: claim a batch of due deliveries, send them concurrently, record each
// outcome, then run the delivery cleanup, the auto-archive sweep and the cycle
// upkeep on their own tick intervals.
async function tick(): Promise<void> {
  const cfg = workerConfig();
  const claimed = await claimDueDeliveries();
  if (claimed.length > 0) {
    await Promise.all(claimed.map(processDelivery));
  }
  await processNotificationDeliveries();
  if (++ticksSinceCleanup >= cfg.cleanupEveryTicks) {
    ticksSinceCleanup = 0;
    const removed = await cleanupOldDeliveries();
    if (removed > 0) console.log(`[worker] cleaned up ${removed} old deliveries`);
  }
  if (++ticksSinceAutoArchive >= cfg.autoArchiveEveryTicks) {
    ticksSinceAutoArchive = 0;
    const archived = await archiveStaleIssues();
    if (archived.length > 0) {
      console.log(`[worker] auto-archived ${archived.length} stale issues`);
      // An unreachable api must not read as a failed tick: the issues are archived
      // either way, and their threads then stay until the agent or team goes.
      try {
        await deleteIssueAgentThreads(archived.map((a) => a.id));
      } catch (error) {
        console.error('[worker] deleting agent threads of archived issues failed:', error);
      }
      try {
        await notifyIssuesArchived(archived);
      } catch (error) {
        console.error('[worker] reporting archived issues for webhooks failed:', error);
      }
    }
  }
  if (++ticksSinceCycleUpkeep >= cfg.cycleUpkeepEveryTicks) {
    ticksSinceCycleUpkeep = 0;
    // An unreachable api must not read as a failed tick: the next run catches up.
    try {
      await runCycleUpkeep();
    } catch (error) {
      console.error('[worker] cycle upkeep failed:', error);
    }
  }
}

// In production a webhook URL that resolves to a private address is not called
// (development and the test suite post to local receivers). An unresolvable host
// fails the attempt the same way.
async function refusedHost(url: string): Promise<boolean> {
  if (process.env.NODE_ENV !== 'production') return false;
  try {
    return await resolvesToPrivate(new URL(url).hostname);
  } catch {
    return true;
  }
}

async function processDelivery(d: ClaimedDelivery): Promise<void> {
  const cfg = workerConfig();
  if (!d.isActive) {
    await markSkippedInactive(d.id);
    return;
  }
  const sentAt = Date.now();
  const result = (await refusedHost(d.url))
    ? { ok: false as const, error: 'url resolves to a private address' }
    : await deliver({
        url: d.url,
        secret: d.secret,
        eventId: d.eventId,
        eventType: d.eventType,
        sentAt,
        body: renderBody(d.payload, sentAt),
        timeoutMs: cfg.timeoutMs,
      });
  const response = { status: result.status, body: result.responseBody };
  if (result.ok) {
    await markSuccess(d.id, d.webhookId, response);
    return;
  }
  const delayS = nextRetryDelayS(d.attempts);
  if (delayS !== null) {
    await scheduleRetry(d.id, delayS * 1000, result.error ?? 'delivery failed', response);
    return;
  }
  await markFailed(d.id, d.webhookId, result.error ?? 'delivery failed', response);
}
