import { db, teamView } from '@repo/db';
import { eq } from 'drizzle-orm';
import { iso } from '../shared/lib';

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
    createdAt: iso(row.createdAt),
  };
}

export async function listViews(teamId: string): Promise<ViewRow[]> {
  const rows = await db
    .select()
    .from(teamView)
    .where(eq(teamView.teamId, teamId))
    .orderBy(teamView.createdAt, teamView.id);
  return rows.map(mapView);
}

// New views go to the end of the tab row (tabs are ordered by creation).
// filters/display are stored verbatim in the jsonb columns.
export async function createView(input: {
  teamId: string;
  name: string;
  icon?: string | null;
  filters?: unknown;
  display?: unknown;
}): Promise<ViewRow> {
  const [row] = await db
    .insert(teamView)
    .values({
      teamId: input.teamId,
      name: input.name,
      icon: input.icon ?? null,
      filters: input.filters ?? {},
      display: input.display ?? {},
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
