import { randomBytes } from 'node:crypto';
import { db, webhook, webhookDelivery } from '@repo/db';
import { and, desc, eq, sql } from 'drizzle-orm';
import { iso } from '../shared/lib';
import { afterCursor, encodeCursor } from '../shared/keyset';

// Outgoing webhook subscriptions (Linear's Webhook). A subscription targets a
// `url`, covers one team or all teams, lists the resource types it receives, and
// carries a per-subscription `secret` that signs delivered payloads. Delivery is
// handled separately; this layer only stores and returns the subscription.

// The Linear resource types a webhook can receive. Keep in sync with the events
// emitted through webhooks/event.ts and the web list (apps/web src/lib/api.ts).
export const WEBHOOK_RESOURCE_TYPES = [
  'Issue',
  'Comment',
  'IssueLabel',
  'Project',
  'ProjectUpdate',
] as const;
export type WebhookResourceType = (typeof WEBHOOK_RESOURCE_TYPES)[number];

export interface WebhookRow {
  id: string;
  teamId: string | null;
  allPublicTeams: boolean;
  url: string;
  label: string | null;
  secret: string;
  resourceTypes: WebhookResourceType[];
  enabled: boolean;
  creatorUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export function mapWebhook(row: typeof webhook.$inferSelect): WebhookRow {
  return {
    id: row.id,
    teamId: row.teamId,
    allPublicTeams: row.allPublicTeams,
    url: row.url,
    label: row.label,
    secret: row.secret,
    resourceTypes: (row.resourceTypes as WebhookResourceType[]) ?? [],
    enabled: row.enabled,
    creatorUserId: row.creatorUserId,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

// A signing secret for a new subscription. Shown to the client so it can verify
// delivered payloads; generated server-side and never derived from user input.
function generateSecret(): string {
  return `whsec_${randomBytes(24).toString('hex')}`;
}

export async function listWebhooks(teamId: string): Promise<WebhookRow[]> {
  const rows = await db
    .select()
    .from(webhook)
    .where(eq(webhook.teamId, teamId))
    .orderBy(webhook.createdAt, webhook.id);
  return rows.map(mapWebhook);
}

export async function listAllTeamsWebhooks(): Promise<WebhookRow[]> {
  const rows = await db
    .select()
    .from(webhook)
    .where(eq(webhook.allPublicTeams, true))
    .orderBy(webhook.createdAt, webhook.id);
  return rows.map(mapWebhook);
}

// teamId null creates an all-teams webhook. A missing secret is generated.
export async function createWebhook(input: {
  teamId: string | null;
  url: string;
  resourceTypes: WebhookResourceType[];
  label?: string | null;
  secret?: string;
  enabled?: boolean;
  creatorUserId: string | null;
}): Promise<WebhookRow> {
  const [row] = await db
    .insert(webhook)
    .values({
      teamId: input.teamId,
      allPublicTeams: input.teamId === null,
      url: input.url,
      label: input.label ?? null,
      secret: input.secret || generateSecret(),
      resourceTypes: input.resourceTypes,
      enabled: input.enabled ?? true,
      creatorUserId: input.creatorUserId,
    })
    .returning();
  return mapWebhook(row!);
}

export async function getWebhook(id: string): Promise<WebhookRow | null> {
  const rows = await db.select().from(webhook).where(eq(webhook.id, id));
  return rows[0] ? mapWebhook(rows[0]) : null;
}

// Updates only the provided fields. Returns null when the webhook does not exist.
export async function updateWebhook(
  id: string,
  patch: {
    url?: string;
    label?: string | null;
    resourceTypes?: WebhookResourceType[];
    enabled?: boolean;
    secret?: string;
  },
): Promise<WebhookRow | null> {
  const set: Partial<typeof webhook.$inferInsert> = {};
  if (patch.url !== undefined) set.url = patch.url;
  if (patch.label !== undefined) set.label = patch.label;
  if (patch.resourceTypes !== undefined) set.resourceTypes = patch.resourceTypes;
  if (patch.enabled !== undefined) set.enabled = patch.enabled;
  // Re-enabling starts the auto-disable count over.
  if (patch.enabled === true) set.consecutiveFailures = 0;
  if (patch.secret !== undefined) set.secret = patch.secret;
  if (Object.keys(set).length === 0) return getWebhook(id);
  set.updatedAt = new Date();
  const [row] = await db.update(webhook).set(set).where(eq(webhook.id, id)).returning();
  return row ? mapWebhook(row) : null;
}

// Replaces the secret with a newly generated one.
export async function rotateWebhookSecret(id: string): Promise<WebhookRow | null> {
  return updateWebhook(id, { secret: generateSecret() });
}

export async function deleteWebhook(id: string): Promise<void> {
  await db.delete(webhook).where(eq(webhook.id, id));
}

// --- Delivery history ------------------------------------------------------------

export interface WebhookDeliveryRow {
  id: string;
  eventId: string;
  eventType: string;
  status: string;
  attempts: number;
  // The payload we sent (the request body), for the "sent" view.
  payload: unknown;
  responseStatus: number | null;
  responseBody: string | null;
  lastError: string | null;
  nextAttemptAt: string;
  createdAt: string;
}

export interface WebhookDeliveryPage {
  items: WebhookDeliveryRow[];
  // The id to pass as `before` to load the next page, or null when at the end.
  nextCursor: string | null;
}

function mapDelivery(row: typeof webhookDelivery.$inferSelect): WebhookDeliveryRow {
  return {
    id: row.id,
    eventId: row.eventId,
    eventType: row.eventType,
    status: row.status,
    attempts: row.attempts,
    payload: row.payload,
    responseStatus: row.responseStatus,
    responseBody: row.responseBody,
    lastError: row.lastError,
    nextAttemptAt: iso(row.nextAttemptAt),
    createdAt: iso(row.createdAt),
  };
}

// One page of the webhook's deliveries, newest first. Keyset pagination on
// (created_at, id) (see shared/keyset.ts): pass the previous page's nextCursor as
// `before` to get the next page. limit is clamped to 1..50.
export async function listWebhookDeliveries(
  webhookId: string,
  opts: { before?: string; limit?: number } = {},
): Promise<WebhookDeliveryPage> {
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 50);
  const rows = await db
    .select({ row: webhookDelivery, cursorTs: sql<string>`${webhookDelivery.createdAt}::text` })
    .from(webhookDelivery)
    .where(
      and(
        eq(webhookDelivery.webhookId, webhookId),
        afterCursor(webhookDelivery.createdAt, webhookDelivery.id, opts.before),
      ),
    )
    .orderBy(desc(webhookDelivery.createdAt), desc(webhookDelivery.id))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return {
    items: page.map((r) => mapDelivery(r.row)),
    nextCursor: hasMore
      ? encodeCursor({ cursorTs: page[page.length - 1].cursorTs, id: page[page.length - 1].row.id })
      : null,
  };
}
