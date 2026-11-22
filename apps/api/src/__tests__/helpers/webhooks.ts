import { db, webhookDelivery } from '@repo/db';
import { desc, eq } from 'drizzle-orm';

// The deliveries queued for a webhook, newest first, read from the database. The API
// has no delivery-log route (Linear lists only failures), so tests check what a
// webhook received here. Shaped like a Treaty response so assertions read
// `.data!.items`.
export async function webhookDeliveries(webhookId: string) {
  const rows = await db
    .select()
    .from(webhookDelivery)
    .where(eq(webhookDelivery.webhookId, webhookId))
    .orderBy(desc(webhookDelivery.createdAt), desc(webhookDelivery.id));
  const items = rows.map((row) => ({
    id: row.id,
    eventId: row.eventId,
    eventType: row.eventType,
    status: row.status,
    attempts: row.attempts,
    payload: row.payload as unknown,
    responseStatus: row.responseStatus,
    responseBody: row.responseBody,
    lastError: row.lastError,
    nextAttemptAt: row.nextAttemptAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  }));
  return { status: 200 as const, data: { items } };
}
