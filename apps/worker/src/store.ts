import { db, webhook, webhookDelivery } from '@repo/db';
import { eq, sql } from 'drizzle-orm';
import { workerConfig } from './config';

export interface ClaimedDelivery {
  id: string;
  webhookId: string;
  eventId: string;
  eventType: string;
  payload: unknown;
  attempts: number;
  url: string;
  secret: string;
  isActive: boolean;
}

// Atomically claims up to batchSize due deliveries. FOR UPDATE SKIP LOCKED lets
// multiple worker replicas run without ever grabbing the same row. Claiming
// pushes next_attempt_at forward by the lease and bumps attempts, so a row whose
// worker crashes mid-delivery becomes claimable again after the lease — no
// separate recovery pass. The webhook's url/secret/enabled are read inline.
export async function claimDueDeliveries(): Promise<ClaimedDelivery[]> {
  const { batchSize, leaseSeconds } = workerConfig();
  const rows = await db.execute(sql`
    UPDATE webhook_delivery d
    SET attempts = d.attempts + 1,
        next_attempt_at = now() + make_interval(secs => ${leaseSeconds})
    WHERE d.id IN (
      SELECT id FROM webhook_delivery
      WHERE status = 'pending' AND next_attempt_at <= now()
      ORDER BY next_attempt_at
      FOR UPDATE SKIP LOCKED
      LIMIT ${batchSize}
    )
    RETURNING
      d.id,
      d.webhook_id AS "webhookId",
      d.event_id AS "eventId",
      d.event_type AS "eventType",
      d.payload,
      d.attempts,
      (SELECT url FROM webhook w WHERE w.id = d.webhook_id) AS url,
      (SELECT secret FROM webhook w WHERE w.id = d.webhook_id) AS secret,
      (SELECT enabled FROM webhook w WHERE w.id = d.webhook_id) AS "isActive"
  `);
  return rows as unknown as ClaimedDelivery[];
}

// The receiver's response recorded for the history view. Absent on a network or
// timeout error (no response arrived).
export interface DeliveryResponse {
  status?: number;
  body?: string;
}

export async function markSuccess(
  deliveryId: string,
  webhookId: string,
  response: DeliveryResponse,
): Promise<void> {
  await db
    .update(webhookDelivery)
    .set({
      status: 'success',
      lastError: null,
      responseStatus: response.status ?? null,
      responseBody: response.body ?? null,
    })
    .where(eq(webhookDelivery.id, deliveryId));
  await db.update(webhook).set({ consecutiveFailures: 0 }).where(eq(webhook.id, webhookId));
}

export async function scheduleRetry(
  deliveryId: string,
  delayMs: number,
  error: string,
  response: DeliveryResponse,
): Promise<void> {
  const delaySeconds = Math.max(1, Math.ceil(delayMs / 1000));
  await db
    .update(webhookDelivery)
    .set({
      status: 'pending',
      nextAttemptAt: sql`now() + make_interval(secs => ${delaySeconds})`,
      lastError: error.slice(0, 500),
      responseStatus: response.status ?? null,
      responseBody: response.body ?? null,
    })
    .where(eq(webhookDelivery.id, deliveryId));
}

export async function markFailed(
  deliveryId: string,
  webhookId: string,
  error: string,
  response: DeliveryResponse,
): Promise<void> {
  await db
    .update(webhookDelivery)
    .set({
      status: 'failed',
      lastError: error.slice(0, 500),
      responseStatus: response.status ?? null,
      responseBody: response.body ?? null,
    })
    .where(eq(webhookDelivery.id, deliveryId));
  await bumpWebhookFailure(webhookId);
}

// A delivery claimed for a webhook that is no longer active (auto-disabled or
// disabled by a user after the row was queued). Drop it without counting another
// failure against the already-disabled webhook.
export async function markSkippedInactive(deliveryId: string): Promise<void> {
  await db
    .update(webhookDelivery)
    .set({ status: 'failed', lastError: 'webhook disabled' })
    .where(eq(webhookDelivery.id, deliveryId));
}

// Counts a delivery that failed for good (after its retries) and auto-disables the
// webhook once the count of consecutive failed deliveries reaches the threshold, in
// one statement. A webhook a user disabled meanwhile stays disabled.
async function bumpWebhookFailure(webhookId: string): Promise<void> {
  const { disableThreshold } = workerConfig();
  await db
    .update(webhook)
    .set({
      consecutiveFailures: sql`${webhook.consecutiveFailures} + 1`,
      enabled: sql`${webhook.enabled} AND (${webhook.consecutiveFailures} + 1) < ${disableThreshold}`,
    })
    .where(eq(webhook.id, webhookId));
}

// Deletes succeeded deliveries older than the cleanup window. Best-effort; returns
// the number removed.
export async function cleanupOldDeliveries(): Promise<number> {
  const { cleanupDays } = workerConfig();
  const res = await db.execute(sql`
    DELETE FROM webhook_delivery
    WHERE status = 'success' AND created_at < now() - make_interval(days => ${cleanupDays})
  `);
  return (res as unknown as { count?: number }).count ?? 0;
}

// Auto-archive sweep (Linear's Team.autoArchivePeriod): archives active issues in a
// completed or canceled state closed longer than their team's period in months
// (team.auto_archive_period; 0 turns it off). The close time is completed_at or
// canceled_at, falling back to updated_at for an issue that has neither. Returns the
// ids archived, which the caller reports for webhooks, with each issue's updated_at
// from before the sweep. Idempotent (archived_at IS NULL filter).
export interface ArchivedIssue {
  id: string;
  previousUpdatedAt: string;
}

export async function archiveStaleIssues(): Promise<ArchivedIssue[]> {
  const rows = await db.execute(sql`
    WITH stale AS (
      SELECT i.id, i.updated_at
      FROM issue i, workflow_state c, team t
      WHERE i.state_id = c.id
        AND i.team_id = t.id
        AND t.auto_archive_period > 0
        AND i.archived_at IS NULL
        AND c.state_type IN ('completed', 'canceled')
        AND coalesce(
              CASE c.state_type WHEN 'completed' THEN i.completed_at ELSE i.canceled_at END,
              i.updated_at
            ) < now() - make_interval(months => t.auto_archive_period)
      FOR UPDATE OF i
    )
    UPDATE issue
    SET archived_at = now(), updated_at = now()
    FROM stale
    WHERE issue.id = stale.id
    RETURNING issue.id, to_json(stale.updated_at) #>> '{}' AS "previousUpdatedAt"
  `);
  return rows as unknown as ArchivedIssue[];
}
