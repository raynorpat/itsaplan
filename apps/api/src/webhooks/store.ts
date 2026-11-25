import { randomBytes } from 'node:crypto';
import { db, webhook } from '@repo/db';
import { eq } from 'drizzle-orm';
import { iso } from '../shared/lib';

// Outgoing webhook subscriptions (Linear's Webhook). A subscription targets a
// `url`, covers one team, all teams or an OAuth application's reach (the application's
// own webhook, managed with the application in oauth/apps.ts and never listed among
// the workspace's webhooks), lists the resource types it receives, and
// carries a per-subscription `secret` that signs delivered payloads. Delivery is
// handled separately; this layer only stores and returns the subscription.

// The Linear resource types a webhook can receive. Keep in sync with the events
// emitted through webhooks/event.ts and the web list (apps/web src/types/workspace.ts).
export const WEBHOOK_RESOURCE_TYPES = [
  'Issue',
  'Comment',
  'IssueLabel',
  'Project',
  'ProjectUpdate',
  'Reaction',
  'Cycle',
  'Initiative',
  'InitiativeUpdate',
  'Document',
  'Attachment',
  'CustomerNeed',
  'Customer',
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
  oauthClientId: string | null;
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
    oauthClientId: row.oauthClientId,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

// A signing secret for a new subscription. Shown to the client so it can verify
// delivered payloads; generated server-side and never derived from user input.
export function generateSecret(): string {
  return `whsec_${randomBytes(24).toString('hex')}`;
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

// The webhook of an OAuth application, if it has one.
export async function getApplicationWebhook(clientId: string): Promise<WebhookRow | null> {
  const rows = await db.select().from(webhook).where(eq(webhook.oauthClientId, clientId));
  return rows[0] ? mapWebhook(rows[0]) : null;
}

// Sets an OAuth application's webhook: url and resource types. Returns the webhook and,
// when it was created now, its new secret (shown once).
export async function setApplicationWebhook(
  clientId: string,
  input: { url: string; resourceTypes: WebhookResourceType[]; creatorUserId: string | null },
): Promise<{ webhook: WebhookRow; createdSecret: string | null }> {
  const existing = await getApplicationWebhook(clientId);
  if (existing) {
    const updated = await updateWebhook(existing.id, {
      url: input.url,
      resourceTypes: input.resourceTypes,
      enabled: true,
    });
    return { webhook: updated!, createdSecret: null };
  }
  const secret = generateSecret();
  const [row] = await db
    .insert(webhook)
    .values({
      oauthClientId: clientId,
      url: input.url,
      secret,
      resourceTypes: input.resourceTypes,
      creatorUserId: input.creatorUserId,
    })
    .returning();
  return { webhook: mapWebhook(row!), createdSecret: secret };
}

export async function deleteApplicationWebhook(clientId: string): Promise<void> {
  await db.delete(webhook).where(eq(webhook.oauthClientId, clientId));
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
