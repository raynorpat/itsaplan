import { db, teamView } from '@repo/db';
import { and, eq, sql } from 'drizzle-orm';
import { iso, num } from '../shared/lib';

// Saved views: the tabs above a team's work items view. filters and display are jsonb
// blobs owned by the UI; this layer stores and returns them without inspecting
// their shape. position orders the tabs.

export interface ViewRow {
  id: string;
  teamId: string;
  name: string;
  icon: string | null;
  filters: unknown;
  display: unknown;
  position: number;
  createdAt: string;
}

function mapView(row: typeof teamView.$inferSelect): ViewRow {
  return {
    id: row.id,
    teamId: row.teamId,
    name: row.name,
    icon: row.icon,
    filters: row.filters,
    display: row.display,
    position: num(row.position),
    createdAt: iso(row.createdAt),
  };
}

export async function listViews(teamId: string): Promise<ViewRow[]> {
  const rows = await db
    .select()
    .from(teamView)
    .where(eq(teamView.teamId, teamId))
    .orderBy(teamView.position, teamView.id);
  return rows.map(mapView);
}

// New views go to the end of the tab row (max position + 1). filters/display are
// stored verbatim in the jsonb columns.
export async function createView(input: {
  teamId: string;
  name: string;
  icon?: string | null;
  filters?: unknown;
  display?: unknown;
}): Promise<ViewRow> {
  const [{ pos }] = await db
    .select({ pos: sql<number>`COALESCE(MAX(${teamView.position}) + 1, 0)` })
    .from(teamView)
    .where(eq(teamView.teamId, input.teamId));
  const [row] = await db
    .insert(teamView)
    .values({
      teamId: input.teamId,
      name: input.name,
      icon: input.icon ?? null,
      filters: input.filters ?? {},
      display: input.display ?? {},
      position: Number(pos),
    })
    .returning();
  return mapView(row);
}

export async function getView(id: string): Promise<ViewRow | null> {
  const rows = await db.select().from(teamView).where(eq(teamView.id, id));
  return rows[0] ? mapView(rows[0]) : null;
}

// Updates only the provided fields. filters/display are replaced wholesale (not
// merged), since the UI always sends the full blob.
export async function updateView(
  id: string,
  patch: { name?: string; icon?: string | null; filters?: unknown; display?: unknown },
): Promise<ViewRow | null> {
  const set: Partial<typeof teamView.$inferInsert> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.icon !== undefined) set.icon = patch.icon;
  if (patch.filters !== undefined) set.filters = patch.filters;
  if (patch.display !== undefined) set.display = patch.display;
  if (Object.keys(set).length === 0) return getView(id);
  const [row] = await db.update(teamView).set(set).where(eq(teamView.id, id)).returning();
  return row ? mapView(row) : null;
}

export async function deleteView(id: string): Promise<void> {
  await db.delete(teamView).where(eq(teamView.id, id));
}

// Sets each view's position to its index in orderedIds, in one transaction, so
// the tab order the UI sends is stored exactly. Ids not on the team are ignored.
export async function reorderViews(teamId: string, orderedIds: string[]): Promise<ViewRow[]> {
  await db.transaction(async (tx) => {
    for (const [position, id] of orderedIds.entries()) {
      await tx
        .update(teamView)
        .set({ position })
        .where(and(eq(teamView.id, id), eq(teamView.teamId, teamId)));
    }
  });
  return listViews(teamId);
}
