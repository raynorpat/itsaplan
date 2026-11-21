import { db, teamDashboard } from '@repo/db';
import { and, eq, sql } from 'drizzle-orm';
import { iso, num } from '../shared/lib';

// Saved dashboards: the analytics tabs of a team. layout is a jsonb blob owned
// by the UI (an ordered list of widget entries); this layer stores and returns it
// without inspecting its shape. position orders the tabs.

export interface DashboardRow {
  id: string;
  teamId: string;
  name: string;
  icon: string | null;
  layout: unknown;
  position: number;
  createdAt: string;
}

function mapDashboard(row: typeof teamDashboard.$inferSelect): DashboardRow {
  return {
    id: row.id,
    teamId: row.teamId,
    name: row.name,
    icon: row.icon,
    layout: row.layout,
    position: num(row.position),
    createdAt: iso(row.createdAt),
  };
}

export async function listDashboards(teamId: string): Promise<DashboardRow[]> {
  const rows = await db
    .select()
    .from(teamDashboard)
    .where(eq(teamDashboard.teamId, teamId))
    .orderBy(teamDashboard.position, teamDashboard.id);
  return rows.map(mapDashboard);
}

// New dashboards go to the end of the tab row (max position + 1). layout is stored
// verbatim in the jsonb column.
export async function createDashboard(input: {
  teamId: string;
  name: string;
  icon?: string | null;
  layout?: unknown;
}): Promise<DashboardRow> {
  const [{ pos }] = await db
    .select({ pos: sql<number>`COALESCE(MAX(${teamDashboard.position}) + 1, 0)` })
    .from(teamDashboard)
    .where(eq(teamDashboard.teamId, input.teamId));
  const [row] = await db
    .insert(teamDashboard)
    .values({
      teamId: input.teamId,
      name: input.name,
      icon: input.icon ?? null,
      layout: input.layout ?? [],
      position: Number(pos),
    })
    .returning();
  return mapDashboard(row);
}

export async function getDashboard(id: string): Promise<DashboardRow | null> {
  const rows = await db.select().from(teamDashboard).where(eq(teamDashboard.id, id));
  return rows[0] ? mapDashboard(rows[0]) : null;
}

// Updates only the provided fields. layout is replaced wholesale (not merged),
// since the UI always sends the full blob.
export async function updateDashboard(
  id: string,
  patch: { name?: string; icon?: string | null; layout?: unknown },
): Promise<DashboardRow | null> {
  const set: Partial<typeof teamDashboard.$inferInsert> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.icon !== undefined) set.icon = patch.icon;
  if (patch.layout !== undefined) set.layout = patch.layout;
  if (Object.keys(set).length === 0) return getDashboard(id);
  const [row] = await db.update(teamDashboard).set(set).where(eq(teamDashboard.id, id)).returning();
  return row ? mapDashboard(row) : null;
}

export async function deleteDashboard(id: string): Promise<void> {
  await db.delete(teamDashboard).where(eq(teamDashboard.id, id));
}

// Sets each dashboard's position to its index in orderedIds, in one transaction,
// so the tab order the UI sends is stored exactly. Ids not on the team are ignored.
export async function reorderDashboards(
  teamId: string,
  orderedIds: string[],
): Promise<DashboardRow[]> {
  await db.transaction(async (tx) => {
    for (const [position, id] of orderedIds.entries()) {
      await tx
        .update(teamDashboard)
        .set({ position })
        .where(and(eq(teamDashboard.id, id), eq(teamDashboard.teamId, teamId)));
    }
  });
  return listDashboards(teamId);
}
