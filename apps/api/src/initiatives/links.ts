import { db, initiativeRelation, initiativeToProject } from '@repo/db';
import { eq, max, sql, type SQL } from 'drizzle-orm';
import { HttpError, iso, pgErrorCode } from '../shared/lib';
import { initiativeData } from '../webhooks/data';
import { sendInitiativeEvent } from './store';

// Projects linked to initiatives (Linear's InitiativeToProject) and sub-initiatives
// (Linear's InitiativeRelation). A project is linked to an initiative once; an
// initiative has one parent, the hierarchy has no loops and at most MAX_LEVELS
// levels. Every change sends an Initiative update for each initiative involved.
// Callers check access first.

const MAX_LEVELS = 5;
const SORT_STEP = 1000;

export interface InitiativeToProjectRow {
  id: string;
  initiativeId: string;
  projectId: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface InitiativeRelationRow {
  id: string;
  initiativeId: string;
  relatedInitiativeId: string;
  sortOrder: number;
  userId: string | null;
  createdAt: string;
  updatedAt: string;
}

export function mapProjectLink(
  row: typeof initiativeToProject.$inferSelect,
): InitiativeToProjectRow {
  return {
    id: row.id,
    initiativeId: row.initiativeId,
    projectId: row.projectId,
    sortOrder: row.sortOrder,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export function mapRelation(row: typeof initiativeRelation.$inferSelect): InitiativeRelationRow {
  return {
    id: row.id,
    initiativeId: row.initiativeId,
    relatedInitiativeId: row.relatedInitiativeId,
    sortOrder: row.sortOrder,
    userId: row.userId,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

// Runs `change` and sends an Initiative update for each of `ids`, with the data
// from before the change.
async function withInitiativeUpdates<T>(
  ids: string[],
  actorUserId: string | null,
  change: () => Promise<T>,
): Promise<T> {
  const before = await Promise.all(ids.map((id) => initiativeData(id)));
  const result = await change();
  for (const [i, id] of ids.entries())
    await sendInitiativeEvent('update', id, actorUserId, before[i]);
  return result;
}

export async function getProjectLink(id: string): Promise<InitiativeToProjectRow | null> {
  const [row] = await db.select().from(initiativeToProject).where(eq(initiativeToProject.id, id));
  return row ? mapProjectLink(row) : null;
}

export async function linkProject(
  input: { initiativeId: string; projectId: string; sortOrder?: number; id?: string },
  actorUserId: string,
): Promise<InitiativeToProjectRow> {
  return withInitiativeUpdates([input.initiativeId], actorUserId, async () => {
    let sortOrder = input.sortOrder;
    if (sortOrder === undefined) {
      const [last] = await db
        .select({ value: max(initiativeToProject.sortOrder) })
        .from(initiativeToProject)
        .where(eq(initiativeToProject.initiativeId, input.initiativeId));
      sortOrder = (last?.value ?? 0) + SORT_STEP;
    }
    try {
      const [row] = await db
        .insert(initiativeToProject)
        .values({
          ...(input.id ? { id: input.id } : {}),
          initiativeId: input.initiativeId,
          projectId: input.projectId,
          sortOrder,
        })
        .returning();
      return mapProjectLink(row!);
    } catch (err) {
      if (pgErrorCode(err) === '23505')
        throw new HttpError(400, 'The project is already linked to this initiative');
      throw err;
    }
  });
}

export async function updateProjectLink(
  id: string,
  patch: { sortOrder: number },
  actorUserId: string,
): Promise<InitiativeToProjectRow> {
  const current = await getProjectLink(id);
  if (!current) throw new HttpError(404, 'Initiative to project link not found');
  return withInitiativeUpdates([current.initiativeId], actorUserId, async () => {
    const [row] = await db
      .update(initiativeToProject)
      .set({ sortOrder: patch.sortOrder, updatedAt: new Date() })
      .where(eq(initiativeToProject.id, id))
      .returning();
    return mapProjectLink(row!);
  });
}

export async function unlinkProject(id: string, actorUserId: string): Promise<void> {
  const current = await getProjectLink(id);
  if (!current) throw new HttpError(404, 'Initiative to project link not found');
  await withInitiativeUpdates([current.initiativeId], actorUserId, () =>
    db.delete(initiativeToProject).where(eq(initiativeToProject.id, id)),
  );
}

export async function getRelation(id: string): Promise<InitiativeRelationRow | null> {
  const [row] = await db.select().from(initiativeRelation).where(eq(initiativeRelation.id, id));
  return row ? mapRelation(row) : null;
}

type Executor = Pick<typeof db, 'execute' | 'select' | 'insert'>;

// The initiative and its ancestors, nearest first.
async function ancestorIds(executor: Executor, id: string): Promise<string[]> {
  const rows = await executor.execute<{ id: string }>(sql`
    WITH RECURSIVE up(id, depth) AS (
      SELECT ${id}::uuid, 0
      UNION ALL
      SELECT r.initiative_id, up.depth + 1
      FROM initiative_relation r JOIN up ON r.related_initiative_id = up.id
      WHERE up.depth < 100
    )
    SELECT id FROM up ORDER BY depth`);
  return rows.map((r) => r.id);
}

// The number of levels in the subtree under `id`, counting `id`.
async function subtreeHeight(executor: Executor, id: string): Promise<number> {
  const [row] = await executor.execute<{ height: number }>(sql`
    WITH RECURSIVE down(id, level) AS (
      SELECT ${id}::uuid, 1
      UNION ALL
      SELECT r.related_initiative_id, down.level + 1
      FROM initiative_relation r JOIN down ON r.initiative_id = down.id
      WHERE down.level < 100
    )
    SELECT max(level)::int AS height FROM down`);
  return row?.height ?? 1;
}

// The root and the descendants reachable through unarchived initiatives matching
// `visible` (SQL over `initiative`). The walk does not enter a hidden or archived
// initiative, so its own descendants are not reached either.
export async function visibleSubtreeIds(rootId: string, visible: SQL): Promise<string[]> {
  const rows = await db.execute<{ id: string }>(sql`
    WITH RECURSIVE down(id, level) AS (
      SELECT ${rootId}::uuid, 1
      UNION ALL
      SELECT r.related_initiative_id, down.level + 1
      FROM initiative_relation r
      JOIN down ON r.initiative_id = down.id
      JOIN initiative ON initiative.id = r.related_initiative_id
      WHERE down.level < 100 AND initiative.archived_at IS NULL AND ${visible}
    )
    SELECT id FROM down`);
  return rows.map((r) => r.id);
}

// Makes `relatedInitiativeId` a sub-initiative of `initiativeId`. The checks and
// the insert run in one transaction holding a lock on the initiative tree, so two
// concurrent relations cannot together form a loop or exceed the depth. The
// messages name no initiative: the checks see the whole tree, including
// initiatives the caller cannot see.
export async function createRelation(
  input: { initiativeId: string; relatedInitiativeId: string; sortOrder?: number; id?: string },
  actorUserId: string,
): Promise<InitiativeRelationRow> {
  const { initiativeId: parentId, relatedInitiativeId: childId } = input;
  if (parentId === childId) throw new HttpError(400, 'An initiative cannot be its own parent');
  return withInitiativeUpdates([parentId, childId], actorUserId, () =>
    db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('initiative_relation'))`);
      const [existing] = await tx
        .select({ id: initiativeRelation.id })
        .from(initiativeRelation)
        .where(eq(initiativeRelation.relatedInitiativeId, childId));
      if (existing) throw new HttpError(400, 'The initiative already has a parent initiative');
      const ancestors = await ancestorIds(tx, parentId);
      if (ancestors.includes(childId))
        throw new HttpError(400, 'The relation would create a loop of initiatives');
      if (ancestors.length + (await subtreeHeight(tx, childId)) > MAX_LEVELS)
        throw new HttpError(400, `Initiatives can be nested at most ${MAX_LEVELS} levels deep`);
      let sortOrder = input.sortOrder;
      if (sortOrder === undefined) {
        const [last] = await tx
          .select({ value: max(initiativeRelation.sortOrder) })
          .from(initiativeRelation)
          .where(eq(initiativeRelation.initiativeId, parentId));
        sortOrder = (last?.value ?? 0) + SORT_STEP;
      }
      const [row] = await tx
        .insert(initiativeRelation)
        .values({
          ...(input.id ? { id: input.id } : {}),
          initiativeId: parentId,
          relatedInitiativeId: childId,
          sortOrder,
          userId: actorUserId,
        })
        .returning();
      return mapRelation(row!);
    }),
  );
}

export async function updateRelation(
  id: string,
  patch: { sortOrder: number },
  actorUserId: string,
): Promise<InitiativeRelationRow> {
  const current = await getRelation(id);
  if (!current) throw new HttpError(404, 'Initiative relation not found');
  return withInitiativeUpdates([current.initiativeId], actorUserId, async () => {
    const [row] = await db
      .update(initiativeRelation)
      .set({ sortOrder: patch.sortOrder, updatedAt: new Date() })
      .where(eq(initiativeRelation.id, id))
      .returning();
    return mapRelation(row!);
  });
}

export async function deleteRelation(id: string, actorUserId: string): Promise<void> {
  const current = await getRelation(id);
  if (!current) throw new HttpError(404, 'Initiative relation not found');
  await withInitiativeUpdates(
    [current.initiativeId, current.relatedInitiativeId],
    actorUserId,
    () => db.delete(initiativeRelation).where(eq(initiativeRelation.id, id)),
  );
}
