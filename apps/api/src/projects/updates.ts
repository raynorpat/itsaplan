import { db, projectUpdate } from '@repo/db';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { iso } from '../shared/lib';
import { emitEvent, type WebhookAction } from '../webhooks/event';
import { projectUpdateData, type WebhookData } from '../webhooks/data';
import { projectTeamIds } from './access';

// Sends a ProjectUpdate webhook event to the webhooks of the project's teams.
async function emitUpdate(
  action: WebhookAction,
  projectId: string,
  actorUserId: string | null,
  data: WebhookData | null,
  before?: WebhookData | null,
): Promise<void> {
  if (!data) return;
  await emitEvent({
    type: 'ProjectUpdate',
    action,
    teamIds: await projectTeamIds(projectId),
    actorUserId,
    data,
    before: before ?? undefined,
  });
}

// Project updates (Linear's ProjectUpdate): status posts with a health reading.
// The newest unarchived update gives the project its health.

export type UpdateHealth = 'onTrack' | 'atRisk' | 'offTrack';

export interface UpdateRow {
  id: string;
  projectId: string;
  userId: string | null;
  body: string;
  health: UpdateHealth;
  editedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function mapUpdate(row: typeof projectUpdate.$inferSelect): UpdateRow {
  return {
    id: row.id,
    projectId: row.projectId,
    userId: row.userId,
    body: row.body,
    health: row.health as UpdateHealth,
    editedAt: row.editedAt ? iso(row.editedAt) : null,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

// Unarchived, newest first.
export async function listUpdates(projectId: string): Promise<UpdateRow[]> {
  const rows = await db
    .select()
    .from(projectUpdate)
    .where(and(eq(projectUpdate.projectId, projectId), isNull(projectUpdate.archivedAt)))
    .orderBy(desc(projectUpdate.createdAt), desc(projectUpdate.id));
  return rows.map(mapUpdate);
}

export async function getUpdate(id: string): Promise<UpdateRow | null> {
  const [row] = await db.select().from(projectUpdate).where(eq(projectUpdate.id, id));
  return row ? mapUpdate(row) : null;
}

export async function createUpdate(
  projectId: string,
  userId: string,
  input: { body: string; health: UpdateHealth },
): Promise<UpdateRow> {
  const [row] = await db
    .insert(projectUpdate)
    .values({ projectId, userId, body: input.body, health: input.health })
    .returning();
  await emitUpdate('create', projectId, userId, await projectUpdateData(row!.id));
  return mapUpdate(row!);
}

export async function updateUpdate(
  id: string,
  patch: { body?: string; health?: UpdateHealth },
  actorUserId: string | null,
): Promise<UpdateRow | null> {
  const before = await projectUpdateData(id);
  const [row] = await db
    .update(projectUpdate)
    .set({ ...patch, editedAt: new Date(), updatedAt: new Date() })
    .where(eq(projectUpdate.id, id))
    .returning();
  if (row)
    await emitUpdate('update', row.projectId, actorUserId, await projectUpdateData(id), before);
  return row ? mapUpdate(row) : null;
}

export async function deleteUpdate(id: string, actorUserId: string | null): Promise<boolean> {
  const before = await projectUpdateData(id);
  const rows = await db
    .delete(projectUpdate)
    .where(eq(projectUpdate.id, id))
    .returning({ id: projectUpdate.id, projectId: projectUpdate.projectId });
  if (rows[0]) await emitUpdate('remove', rows[0].projectId, actorUserId, before);
  return rows.length > 0;
}

// Sets or clears archived_at (projectUpdateArchive / Unarchive). An archive is sent
// to webhooks as a remove, an unarchive as an update.
export async function setUpdateArchived(
  id: string,
  archived: boolean,
  actorUserId: string | null,
): Promise<typeof projectUpdate.$inferSelect | null> {
  const before = await projectUpdateData(id);
  const [row] = await db
    .update(projectUpdate)
    .set({ archivedAt: archived ? new Date() : null })
    .where(eq(projectUpdate.id, id))
    .returning();
  if (row)
    await emitUpdate(
      archived ? 'remove' : 'update',
      row.projectId,
      actorUserId,
      await projectUpdateData(id),
      before,
    );
  return row ?? null;
}

// The latest unarchived update's health per project.
export async function latestHealthFor(projectIds: string[]): Promise<Map<string, UpdateHealth>> {
  const out = new Map<string, UpdateHealth>();
  if (projectIds.length === 0) return out;
  const rows = await db
    .selectDistinctOn([projectUpdate.projectId], {
      projectId: projectUpdate.projectId,
      health: projectUpdate.health,
    })
    .from(projectUpdate)
    .where(and(inArray(projectUpdate.projectId, projectIds), isNull(projectUpdate.archivedAt)))
    .orderBy(projectUpdate.projectId, desc(projectUpdate.createdAt), desc(projectUpdate.id));
  for (const r of rows) out.set(r.projectId, r.health as UpdateHealth);
  return out;
}
