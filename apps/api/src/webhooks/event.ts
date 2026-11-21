import { randomUUID } from 'node:crypto';
import { db, user, webhook, webhookDelivery } from '@repo/db';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { getOrganization } from '../graphql/resolvers/organization';
import type { WebhookResourceType } from './store';

// Queues Linear-format webhook deliveries (https://linear.app/developers/webhooks).
// Called by the stores right after a change, with the entity's webhook data
// before and after it. One delivery row per matching webhook, all sharing one
// event id (sent as Linear-Delivery, stable across retries). The worker adds
// webhookTimestamp at send time and signs the body.

export type WebhookAction = 'create' | 'update' | 'remove';

type Data = Record<string, unknown>;

// Nested objects repeat the relation ids (teamId, stateId, …), so they stay out of
// the diff.
const NOT_DIFFED = new Set(['team', 'state', 'assignee', 'labels']);

// Linear's updatedFrom: the previous values of the fields that changed (a
// previously unset value is null), plus the previous updatedAt.
export function updatedFrom(before: Data, after: Data): Data {
  const out: Data = {};
  for (const key of Object.keys(after)) {
    if (key === 'updatedAt' || NOT_DIFFED.has(key)) continue;
    if (JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null))
      out[key] = before[key] ?? null;
  }
  out.updatedAt = before.updatedAt ?? null;
  return out;
}

async function actorFor(userId: string | null) {
  if (!userId) return null;
  const [row] = await db
    .select({ id: user.id, name: user.name, email: user.email })
    .from(user)
    .where(eq(user.id, userId));
  return row ? { id: row.id, type: 'user', name: row.name, email: row.email } : null;
}

export async function emitEvent(input: {
  type: WebhookResourceType;
  action: WebhookAction;
  // The teams the entity belongs to; team webhooks of these teams match.
  teamIds: string[];
  actorUserId: string | null;
  data: Data;
  // The entity before the change, for an update.
  before?: Data;
}): Promise<void> {
  let changes: Data | undefined;
  if (input.action === 'update') {
    changes = updatedFrom(input.before ?? {}, input.data);
    if (Object.keys(changes).length <= 1) return; // only updatedAt
  }
  const teamMatch = input.teamIds.length ? inArray(webhook.teamId, input.teamIds) : undefined;
  const matching = await db
    .select({ id: webhook.id })
    .from(webhook)
    .where(
      and(
        eq(webhook.enabled, true),
        sql`${webhook.resourceTypes} @> ${JSON.stringify([input.type])}::jsonb`,
        or(eq(webhook.allPublicTeams, true), teamMatch),
      ),
    );
  if (matching.length === 0) return;

  const eventId = randomUUID();
  const base = {
    action: input.action,
    type: input.type,
    actor: await actorFor(input.actorUserId),
    createdAt: new Date().toISOString(),
    data: input.data,
    ...(changes ? { updatedFrom: changes } : {}),
    url: input.data.url,
    organizationId: (await getOrganization()).id,
  };
  await db.insert(webhookDelivery).values(
    matching.map((h) => ({
      webhookId: h.id,
      eventId,
      eventType: input.type,
      payload: { ...base, webhookId: h.id },
    })),
  );
}
