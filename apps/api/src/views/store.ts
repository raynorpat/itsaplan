import { db, teamView, viewPreferences } from '@repo/db';
import { and, eq, sql } from 'drizzle-orm';
import { iso } from '../shared/lib';

// Saved views (Linear's CustomView): a team's named issue filter. `filterData` is
// Linear's IssueFilter and the only stored filter; the layout and display settings
// are the view's organization view preferences (`view_preferences`). Views list in
// creation order.

export interface ViewRow {
  id: string;
  teamId: string;
  name: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  filterData: unknown;
  shared: boolean;
  slugId: string;
  creatorUserId: string | null;
  ownerUserId: string | null;
  updatedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export function mapView(row: typeof teamView.$inferSelect): ViewRow {
  return {
    id: row.id,
    teamId: row.teamId,
    name: row.name,
    description: row.description,
    icon: row.icon,
    color: row.color,
    filterData: row.filterData,
    shared: row.shared,
    slugId: row.slugId,
    creatorUserId: row.creatorUserId,
    ownerUserId: row.ownerUserId,
    updatedByUserId: row.updatedByUserId,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
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

export interface ViewInput {
  name: string;
  description?: string | null;
  icon?: string | null;
  color?: string | null;
  filterData?: unknown;
  shared?: boolean;
  ownerUserId?: string | null;
  id?: string;
}

export async function createView(
  teamId: string,
  input: ViewInput,
  actorUserId: string,
): Promise<ViewRow> {
  const [row] = await db
    .insert(teamView)
    .values({
      ...(input.id ? { id: input.id } : {}),
      teamId,
      name: input.name,
      description: input.description ?? null,
      icon: input.icon ?? null,
      color: input.color ?? null,
      filterData: input.filterData ?? {},
      shared: input.shared ?? true,
      creatorUserId: actorUserId,
      ownerUserId: input.ownerUserId ?? actorUserId,
      updatedByUserId: actorUserId,
    })
    .returning();
  return mapView(row!);
}

export async function getView(idOrSlug: string): Promise<ViewRow | null> {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug);
  const rows = await db
    .select()
    .from(teamView)
    .where(isUuid ? eq(teamView.id, idOrSlug) : eq(teamView.slugId, idOrSlug));
  return rows[0] ? mapView(rows[0]) : null;
}

// Updates only the provided fields; filterData is replaced wholesale.
export async function updateView(
  id: string,
  patch: Partial<Omit<ViewInput, 'id'>> & { teamId?: string },
  actorUserId: string,
): Promise<ViewRow | null> {
  const set: Partial<typeof teamView.$inferInsert> = {};
  for (const key of [
    'name',
    'description',
    'icon',
    'color',
    'filterData',
    'shared',
    'ownerUserId',
    'teamId',
  ] as const) {
    if (patch[key] !== undefined) (set as Record<string, unknown>)[key] = patch[key];
  }
  if (Object.keys(set).length === 0) return getView(id);
  const [row] = await db
    .update(teamView)
    .set({ ...set, updatedByUserId: actorUserId, updatedAt: sql`now()` })
    .where(eq(teamView.id, id))
    .returning();
  return row ? mapView(row) : null;
}

export async function deleteView(id: string): Promise<void> {
  await db.delete(teamView).where(eq(teamView.id, id));
}

// --- View preferences -------------------------------------------------------------

export interface ViewPreferencesRow {
  id: string;
  type: 'organization' | 'user';
  viewType: string;
  customViewId: string;
  userId: string | null;
  preferences: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

function mapPrefs(row: typeof viewPreferences.$inferSelect): ViewPreferencesRow {
  return {
    id: row.id,
    type: row.type as 'organization' | 'user',
    viewType: row.viewType,
    customViewId: row.customViewId,
    userId: row.userId,
    preferences: (row.preferences ?? {}) as Record<string, unknown>,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export async function getViewPreferences(id: string): Promise<ViewPreferencesRow | null> {
  const [row] = await db.select().from(viewPreferences).where(eq(viewPreferences.id, id));
  return row ? mapPrefs(row) : null;
}

// The view's organization preferences, or one user's own.
export async function viewPreferencesFor(
  customViewId: string,
  type: 'organization' | 'user',
  userId?: string,
): Promise<ViewPreferencesRow | null> {
  const [row] = await db
    .select()
    .from(viewPreferences)
    .where(
      and(
        eq(viewPreferences.customViewId, customViewId),
        eq(viewPreferences.type, type),
        type === 'user' ? eq(viewPreferences.userId, userId!) : undefined,
      ),
    );
  return row ? mapPrefs(row) : null;
}

// Creates or replaces the view's preferences of the given type (one organization
// row per view, one user row per view and user).
export async function upsertViewPreferences(input: {
  customViewId: string;
  type: 'organization' | 'user';
  userId?: string | null;
  preferences: Record<string, unknown>;
  id?: string;
}): Promise<ViewPreferencesRow> {
  const existing = await viewPreferencesFor(
    input.customViewId,
    input.type,
    input.userId ?? undefined,
  );
  if (existing) return (await updateViewPreferences(existing.id, input.preferences))!;
  const [row] = await db
    .insert(viewPreferences)
    .values({
      ...(input.id ? { id: input.id } : {}),
      type: input.type,
      viewType: 'customView',
      customViewId: input.customViewId,
      userId: input.type === 'user' ? input.userId! : null,
      preferences: input.preferences,
    })
    .returning();
  return mapPrefs(row!);
}

export async function updateViewPreferences(
  id: string,
  preferences: Record<string, unknown>,
): Promise<ViewPreferencesRow | null> {
  const [row] = await db
    .update(viewPreferences)
    .set({ preferences, updatedAt: sql`now()` })
    .where(eq(viewPreferences.id, id))
    .returning();
  return row ? mapPrefs(row) : null;
}

export async function deleteViewPreferences(id: string): Promise<void> {
  await db.delete(viewPreferences).where(eq(viewPreferences.id, id));
}
