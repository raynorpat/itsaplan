import { db, initiativeUpdate } from '@repo/db';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { HttpError, iso } from '../shared/lib';
import { emitEvent, type WebhookAction } from '../webhooks/event';
import { initiativeUpdateData, type WebhookData } from '../webhooks/data';
import type { UpdateHealth } from '../projects/updates';
import { getInitiative } from './store';

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

export async function createInitiativeUpdate(
  initiativeId: string,
  userId: string,
  input: { body: string; health?: UpdateHealth; id?: string },
): Promise<InitiativeUpdateRow> {
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
}

export async function updateInitiativeUpdate(
  id: string,
  patch: { body?: string; health?: UpdateHealth },
  actorUserId: string | null,
): Promise<InitiativeUpdateRow> {
  const before = await initiativeUpdateData(id);
  const [row] = await db
    .update(initiativeUpdate)
    .set({ ...patch, editedAt: new Date(), updatedAt: new Date() })
    .where(eq(initiativeUpdate.id, id))
    .returning();
  if (!row) throw new HttpError(404, 'Initiative update not found');
  const updated = mapInitiativeUpdate(row);
  await sendUpdateEvent('update', updated, actorUserId, before);
  return updated;
}

// Archiving sends `remove`, unarchiving `update`.
export async function setInitiativeUpdateArchived(
  id: string,
  archived: boolean,
  actorUserId: string | null,
): Promise<InitiativeUpdateRow> {
  const before = await initiativeUpdateData(id);
  const [row] = await db
    .update(initiativeUpdate)
    .set({ archivedAt: archived ? new Date() : null })
    .where(eq(initiativeUpdate.id, id))
    .returning();
  if (!row) throw new HttpError(404, 'Initiative update not found');
  const changed = mapInitiativeUpdate(row);
  await sendUpdateEvent(archived ? 'remove' : 'update', changed, actorUserId, before);
  return changed;
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
