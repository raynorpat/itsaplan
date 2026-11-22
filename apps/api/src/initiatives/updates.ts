import { db, initiativeUpdate } from '@repo/db';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { HttpError, iso } from '../shared/lib';
import { emitEvent, type WebhookAction } from '../webhooks/event';
import { initiativeData, initiativeUpdateData, type WebhookData } from '../webhooks/data';
import type { UpdateHealth } from '../projects/updates';
import { getInitiative, sendInitiativeEvent } from './store';

// Initiative updates (Linear's InitiativeUpdate): status posts with a health
// reading. The newest update that is not archived gives the initiative its health.
// Callers check access to the initiative first.

export interface InitiativeUpdateRow {
  id: string;
  initiativeId: string;
  userId: string | null;
  body: string;
  health: UpdateHealth;
  editedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function mapInitiativeUpdate(
  row: typeof initiativeUpdate.$inferSelect,
): InitiativeUpdateRow {
  return {
    id: row.id,
    initiativeId: row.initiativeId,
    userId: row.userId,
    body: row.body,
    health: row.health as UpdateHealth,
    editedAt: row.editedAt ? iso(row.editedAt) : null,
    archivedAt: row.archivedAt ? iso(row.archivedAt) : null,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

// Sends an InitiativeUpdate event to the lead team's webhooks, or to all-teams
// webhooks only for a workspace initiative.
async function sendUpdateEvent(
  action: WebhookAction,
  row: InitiativeUpdateRow,
  actorUserId: string | null,
  before?: WebhookData | null,
): Promise<void> {
  const data = await initiativeUpdateData(row.id);
  if (!data) return;
  const parent = await getInitiative(row.initiativeId);
  await emitEvent({
    type: 'InitiativeUpdate',
    action,
    teamIds: parent?.leadTeamId ? [parent.leadTeamId] : [],
    actorUserId,
    data,
    before: before ?? undefined,
  });
}

export async function getInitiativeUpdate(id: string): Promise<InitiativeUpdateRow | null> {
  const [row] = await db.select().from(initiativeUpdate).where(eq(initiativeUpdate.id, id));
  return row ? mapInitiativeUpdate(row) : null;
}

// Runs `change` and sends an Initiative update when it changed the initiative's
// health or last update (emitEvent drops an update with no changed field).
async function withHealthEvent<T>(
  initiativeId: string,
  actorUserId: string | null,
  change: () => Promise<T>,
): Promise<T> {
  const before = await initiativeData(initiativeId);
  const result = await change();
  await sendInitiativeEvent('update', initiativeId, actorUserId, before);
  return result;
}

export async function createInitiativeUpdate(
  initiativeId: string,
  userId: string,
  input: { body: string; health?: UpdateHealth; id?: string },
): Promise<InitiativeUpdateRow> {
  return withHealthEvent(initiativeId, userId, async () => {
    const [row] = await db
      .insert(initiativeUpdate)
      .values({
        ...(input.id ? { id: input.id } : {}),
        initiativeId,
        userId,
        body: input.body,
        health: input.health ?? 'onTrack',
      })
      .returning();
    const created = mapInitiativeUpdate(row!);
    await sendUpdateEvent('create', created, userId);
    return created;
  });
}

export async function updateInitiativeUpdate(
  id: string,
  patch: { body?: string; health?: UpdateHealth },
  actorUserId: string | null,
): Promise<InitiativeUpdateRow> {
  const current = await getInitiativeUpdate(id);
  if (!current) throw new HttpError(404, 'Initiative update not found');
  return withHealthEvent(current.initiativeId, actorUserId, async () => {
    const before = await initiativeUpdateData(id);
    const [row] = await db
      .update(initiativeUpdate)
      .set({ ...patch, editedAt: new Date(), updatedAt: new Date() })
      .where(eq(initiativeUpdate.id, id))
      .returning();
    const updated = mapInitiativeUpdate(row!);
    await sendUpdateEvent('update', updated, actorUserId, before);
    return updated;
  });
}

// Archiving sends `remove`, unarchiving `update`.
export async function setInitiativeUpdateArchived(
  id: string,
  archived: boolean,
  actorUserId: string | null,
): Promise<InitiativeUpdateRow> {
  const current = await getInitiativeUpdate(id);
  if (!current) throw new HttpError(404, 'Initiative update not found');
  return withHealthEvent(current.initiativeId, actorUserId, async () => {
    const before = await initiativeUpdateData(id);
    const [row] = await db
      .update(initiativeUpdate)
      .set({ archivedAt: archived ? new Date() : null })
      .where(eq(initiativeUpdate.id, id))
      .returning();
    const changed = mapInitiativeUpdate(row!);
    await sendUpdateEvent(archived ? 'remove' : 'update', changed, actorUserId, before);
    return changed;
  });
}

export async function latestInitiativeUpdate(
  initiativeId: string,
): Promise<InitiativeUpdateRow | null> {
  const [row] = await db
    .select()
    .from(initiativeUpdate)
    .where(
      and(eq(initiativeUpdate.initiativeId, initiativeId), isNull(initiativeUpdate.archivedAt)),
    )
    .orderBy(desc(initiativeUpdate.createdAt), desc(initiativeUpdate.id))
    .limit(1);
  return row ? mapInitiativeUpdate(row) : null;
}
