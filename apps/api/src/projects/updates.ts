import { db, projectUpdate } from '@repo/db';
import { desc, eq, inArray } from 'drizzle-orm';
import { iso } from '../shared/lib';

// Project updates (Linear's ProjectUpdate): status posts with a health reading.
// The newest update gives the project its health.

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

// Newest first.
export async function listUpdates(projectId: string): Promise<UpdateRow[]> {
  const rows = await db
    .select()
    .from(projectUpdate)
    .where(eq(projectUpdate.projectId, projectId))
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
  return mapUpdate(row!);
}

export async function updateUpdate(
  id: string,
  patch: { body?: string; health?: UpdateHealth },
): Promise<UpdateRow | null> {
  const [row] = await db
    .update(projectUpdate)
    .set({ ...patch, editedAt: new Date(), updatedAt: new Date() })
    .where(eq(projectUpdate.id, id))
    .returning();
  return row ? mapUpdate(row) : null;
}

export async function deleteUpdate(id: string): Promise<boolean> {
  const rows = await db
    .delete(projectUpdate)
    .where(eq(projectUpdate.id, id))
    .returning({ id: projectUpdate.id });
  return rows.length > 0;
}

// The latest update's health per project.
export async function latestHealthFor(projectIds: string[]): Promise<Map<string, UpdateHealth>> {
  const out = new Map<string, UpdateHealth>();
  if (projectIds.length === 0) return out;
  const rows = await db
    .selectDistinctOn([projectUpdate.projectId], {
      projectId: projectUpdate.projectId,
      health: projectUpdate.health,
    })
    .from(projectUpdate)
    .where(inArray(projectUpdate.projectId, projectIds))
    .orderBy(projectUpdate.projectId, desc(projectUpdate.createdAt), desc(projectUpdate.id));
  for (const r of rows) out.set(r.projectId, r.health as UpdateHealth);
  return out;
}
