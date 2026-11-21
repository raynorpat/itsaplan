import { db, teamAction } from '@repo/db';
import { and, eq, sql } from 'drizzle-orm';
import { iso, num } from '../shared/lib';

// Manual actions: saved macros on a team. condition is a filter set deciding
// which issues the action applies to (empty = always); effect is a partial issue
// patch applied in one update. Both jsonb blobs are owned by the UI; this layer
// stores and returns them without inspecting their shape.

export interface ActionRow {
  id: string;
  teamId: string;
  name: string;
  icon: string;
  condition: unknown;
  effect: unknown;
  position: number;
  createdAt: string;
}

function mapAction(row: typeof teamAction.$inferSelect): ActionRow {
  return {
    id: row.id,
    teamId: row.teamId,
    name: row.name,
    icon: row.icon,
    condition: row.condition,
    effect: row.effect,
    position: num(row.position),
    createdAt: iso(row.createdAt),
  };
}

export async function listActions(teamId: string): Promise<ActionRow[]> {
  const rows = await db
    .select()
    .from(teamAction)
    .where(eq(teamAction.teamId, teamId))
    .orderBy(teamAction.position, teamAction.id);
  return rows.map(mapAction);
}

// New actions go to the end of the list (max position + 1). condition/effect are
// stored verbatim in the jsonb columns.
export async function createAction(input: {
  teamId: string;
  name: string;
  icon?: string;
  condition?: unknown;
  effect?: unknown;
}): Promise<ActionRow> {
  const [{ pos }] = await db
    .select({ pos: sql<number>`COALESCE(MAX(${teamAction.position}) + 1, 0)` })
    .from(teamAction)
    .where(eq(teamAction.teamId, input.teamId));
  const [row] = await db
    .insert(teamAction)
    .values({
      teamId: input.teamId,
      name: input.name,
      icon: input.icon ?? '',
      condition: input.condition ?? {},
      effect: input.effect ?? {},
      position: Number(pos),
    })
    .returning();
  return mapAction(row);
}

export async function getAction(id: string): Promise<ActionRow | null> {
  const rows = await db.select().from(teamAction).where(eq(teamAction.id, id));
  return rows[0] ? mapAction(rows[0]) : null;
}

// Updates only the provided fields. condition/effect are replaced wholesale (not
// merged), since the UI always sends the full blob.
export async function updateAction(
  id: string,
  patch: { name?: string; icon?: string; condition?: unknown; effect?: unknown },
): Promise<ActionRow | null> {
  const set: Partial<typeof teamAction.$inferInsert> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.icon !== undefined) set.icon = patch.icon;
  if (patch.condition !== undefined) set.condition = patch.condition;
  if (patch.effect !== undefined) set.effect = patch.effect;
  if (Object.keys(set).length === 0) return getAction(id);
  const [row] = await db.update(teamAction).set(set).where(eq(teamAction.id, id)).returning();
  return row ? mapAction(row) : null;
}

export async function deleteAction(id: string): Promise<void> {
  await db.delete(teamAction).where(eq(teamAction.id, id));
}

// Sets each action's position to its index in orderedIds, in one transaction, so
// the order the UI sends is stored exactly. Ids not on the team are ignored.
export async function reorderActions(teamId: string, orderedIds: string[]): Promise<ActionRow[]> {
  await db.transaction(async (tx) => {
    for (const [position, id] of orderedIds.entries()) {
      await tx
        .update(teamAction)
        .set({ position })
        .where(and(eq(teamAction.id, id), eq(teamAction.teamId, teamId)));
    }
  });
  return listActions(teamId);
}
