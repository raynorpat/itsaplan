import { dashboard, db, team, teamMember, user } from '@repo/db';
import { and, desc, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import { atLeast, memberTeamIds, workspaceRole, type AuthUser } from '../shared/access';
import { HttpError, iso, UUID_RE } from '../shared/lib';
import { shownNameSql } from '../shared/user-name';

// Dashboards (`dashboard`): pages of Insights widgets, stored here since Linear's
// schema has no dashboard type. Owners, admins and members see the workspace's
// dashboards and those shared with a team they are in; owners and admins see every
// dashboard; the owner always sees their own. The owner and owners / admins edit; anyone
// who sees one duplicates it. A suspended owner reads as no owner, and teams deleted
// since drop out of `teamIds`.
// Guests (and app users) have none. `widgets` is the web's configuration, checked here
// only for its shape.

export interface DashboardSummary {
  id: string;
  name: string;
  description: string;
  ownerId: string | null;
  ownerName: string | null;
  systemKey: string | null;
  sharedWith: 'workspace' | 'teams';
  teamIds: string[];
  canEdit: boolean;
  updatedAt: string;
}

export interface DashboardDto extends DashboardSummary {
  widgets: unknown[];
}

type Row = typeof dashboard.$inferSelect;

const MAX_NAME = 255;
const MAX_DESCRIPTION = 10_000;
const MAX_WIDGETS = 24;
const MAX_WIDGETS_BYTES = 100_000;
const MAX_TEAMS = 100;
const WIDGET_KINDS = new Set(['chart', 'number', 'table']);
const WIDGET_WIDTHS = new Set(['half', 'full']);
export const FEEDBACK_KEY = 'feedback';

interface Viewer {
  id: string;
  admin: boolean;
}

// The caller, refused when a guest or an app user (403).
async function viewer(user: AuthUser): Promise<Viewer> {
  const role = await workspaceRole(user.id);
  if (role === 'guest') throw new HttpError(403, 'Guests have no dashboards');
  return { id: user.id, admin: atLeast(role, 'admin') };
}

// SQL condition: the dashboards the viewer sees.
function visibleSql(v: Viewer): SQL | undefined {
  if (v.admin) return undefined;
  return or(
    eq(dashboard.sharedWith, 'workspace'),
    eq(dashboard.ownerId, v.id),
    sql`${dashboard.teamIds} && array(${memberTeamIds(v.id)})::uuid[]`,
  );
}

const canEdit = (v: Viewer, row: Row): boolean => v.admin || row.ownerId === v.id;

const SELECT = {
  row: dashboard,
  ownerName: sql<string | null>`${shownNameSql}`,
  ownerSuspended: sql<boolean>`${user.suspendedAt} IS NOT NULL`,
  // The shared teams that still exist, in their stored order.
  teamIds: sql<string[]>`array(
    SELECT u.id FROM unnest(${dashboard.teamIds}) WITH ORDINALITY AS u(id, n)
    WHERE EXISTS (SELECT 1 FROM ${team} WHERE ${team.id} = u.id) ORDER BY u.n)`,
};

type Found = { row: Row; ownerName: string | null; ownerSuspended: boolean; teamIds: string[] };

async function rows(v: Viewer, where?: SQL) {
  return db
    .select(SELECT)
    .from(dashboard)
    .leftJoin(user, eq(user.id, dashboard.ownerId))
    .where(and(visibleSql(v), where))
    .orderBy(desc(dashboard.updatedAt), dashboard.id);
}

function summary(v: Viewer, r: Found): DashboardSummary {
  const ownerId = r.ownerSuspended ? null : r.row.ownerId;
  return {
    id: r.row.id,
    name: r.row.name,
    description: r.row.description,
    ownerId,
    ownerName: ownerId ? r.ownerName : null,
    systemKey: r.row.systemKey,
    sharedWith: r.row.sharedWith as DashboardSummary['sharedWith'],
    teamIds: r.teamIds,
    canEdit: canEdit(v, r.row),
    updatedAt: iso(r.row.updatedAt),
  };
}

const dto = (v: Viewer, r: Found): DashboardDto => ({
  ...summary(v, r),
  widgets: r.row.widgets as unknown[],
});

async function visible(v: Viewer, id: unknown) {
  if (typeof id !== 'string' || !UUID_RE.test(id)) throw new HttpError(400, 'id must be an id');
  const [found] = await rows(v, eq(dashboard.id, id));
  if (!found) throw new HttpError(404, 'Dashboard not found');
  return found;
}

async function editable(v: Viewer, id: unknown) {
  const found = await visible(v, id);
  if (!canEdit(v, found.row))
    throw new HttpError(403, 'Only the owner or a workspace admin can change this dashboard');
  return found;
}

// --- Input -----------------------------------------------------------------------

function name(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new HttpError(400, 'name is required');
  const out = value.trim();
  if (out.length > MAX_NAME) throw new HttpError(400, `name is at most ${MAX_NAME} characters`);
  return out;
}

function description(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.length > MAX_DESCRIPTION)
    throw new HttpError(400, `description must be text of at most ${MAX_DESCRIPTION} characters`);
  return value;
}

// The widget list: at most 24 objects, each with its own string id, a kind (chart,
// number, table), a width (half, full) and a config object; at most 100 KB as JSON.
// Copied into plain objects before storing.
export function parseWidgets(value: unknown): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_WIDGETS)
    throw new HttpError(400, `widgets must be a list of at most ${MAX_WIDGETS} widgets`);
  for (const w of value) {
    const item = w as Record<string, unknown> | null;
    if (
      typeof item !== 'object' ||
      item === null ||
      typeof item.id !== 'string' ||
      !item.id ||
      !WIDGET_KINDS.has(item.kind as string) ||
      !WIDGET_WIDTHS.has(item.width as string) ||
      typeof item.config !== 'object' ||
      item.config === null ||
      Array.isArray(item.config)
    )
      throw new HttpError(400, 'Each widget needs an id, a kind, a width and a config');
  }
  const ids = value.map((w) => (w as { id: string }).id);
  if (new Set(ids).size !== ids.length) throw new HttpError(400, 'Widget ids must be unique');
  const json = JSON.stringify(value);
  if (new TextEncoder().encode(json).length > MAX_WIDGETS_BYTES)
    throw new HttpError(400, 'The widgets are too large');
  return JSON.parse(json) as unknown[];
}

// The sharing: the workspace, or at least one team; a member may name only teams they
// are in, an admin any team that exists.
async function sharing(
  v: Viewer,
  sharedWith: unknown,
  teamIds: unknown,
): Promise<{ sharedWith: 'workspace' | 'teams'; teamIds: string[] }> {
  if (sharedWith === 'workspace') return { sharedWith, teamIds: [] };
  if (sharedWith !== 'teams') throw new HttpError(400, 'sharedWith must be workspace or teams');
  if (
    !Array.isArray(teamIds) ||
    teamIds.length === 0 ||
    teamIds.length > MAX_TEAMS ||
    teamIds.some((id) => typeof id !== 'string' || !UUID_RE.test(id))
  )
    throw new HttpError(400, 'teamIds must list the teams to share with');
  const ids = [...new Set(teamIds as string[])];
  if (v.admin) {
    const known = await db.select({ id: team.id }).from(team).where(inArray(team.id, ids));
    if (known.length !== ids.length) throw new HttpError(400, 'teamIds must name existing teams');
  } else if ((await teamsOf(v, ids)).length !== ids.length)
    throw new HttpError(400, 'A dashboard can be shared only with teams you are in');
  return { sharedWith, teamIds: ids };
}

// Of `ids`, the teams the viewer is in, in the order given.
async function teamsOf(v: Viewer, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const mine = await db
    .select({ id: teamMember.teamId })
    .from(teamMember)
    .where(and(eq(teamMember.userId, v.id), inArray(teamMember.teamId, ids)));
  const set = new Set(mine.map((m) => m.id));
  return ids.filter((id) => set.has(id));
}

const fields = (body: unknown): Record<string, unknown> =>
  typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};

// --- Operations --------------------------------------------------------------------

export async function listDashboards(user: AuthUser): Promise<DashboardSummary[]> {
  const v = await viewer(user);
  return (await rows(v)).map((r) => summary(v, r));
}

export async function getDashboard(user: AuthUser, id: unknown): Promise<DashboardDto> {
  const v = await viewer(user);
  return dto(v, await visible(v, id));
}

async function reread(v: Viewer, id: string): Promise<DashboardDto> {
  return dto(v, await visible(v, id));
}

export async function createDashboard(user: AuthUser, body: unknown): Promise<DashboardDto> {
  const v = await viewer(user);
  const input = fields(body);
  const values = {
    name: name(input.name),
    description: description(input.description),
    ...(await sharing(v, input.sharedWith, input.teamIds)),
    widgets: parseWidgets(input.widgets),
    ownerId: v.id,
  };
  const [row] = await db.insert(dashboard).values(values).returning({ id: dashboard.id });
  return reread(v, row!.id);
}

export async function updateDashboard(user: AuthUser, body: unknown): Promise<DashboardDto> {
  const v = await viewer(user);
  const input = fields(body);
  const found = await editable(v, input.id);
  const patch: Partial<typeof dashboard.$inferInsert> = { updatedAt: new Date() };
  if (input.name !== undefined) patch.name = name(input.name);
  if (input.description !== undefined) patch.description = description(input.description);
  if (input.widgets !== undefined) patch.widgets = parseWidgets(input.widgets);
  if (input.sharedWith !== undefined || input.teamIds !== undefined) {
    if (found.row.systemKey)
      throw new HttpError(400, 'The feedback report is shared with the workspace');
    Object.assign(
      patch,
      await sharing(v, input.sharedWith ?? found.row.sharedWith, input.teamIds ?? found.teamIds),
    );
  }
  await db.update(dashboard).set(patch).where(eq(dashboard.id, found.row.id));
  return reread(v, found.row.id);
}

export async function deleteDashboard(user: AuthUser, body: unknown): Promise<void> {
  const v = await viewer(user);
  const found = await editable(v, fields(body).id);
  await db.delete(dashboard).where(eq(dashboard.id, found.row.id));
}

// A copy owned by the caller. A team dashboard's copy is shared with the original's
// teams the caller may name (an admin all of them, a member those they are in), or with
// the workspace when that leaves none.
export async function duplicateDashboard(user: AuthUser, body: unknown): Promise<DashboardDto> {
  const v = await viewer(user);
  const found = await visible(v, fields(body).id);
  let shared: { sharedWith: 'workspace' | 'teams'; teamIds: string[] } = {
    sharedWith: 'workspace',
    teamIds: [],
  };
  if (found.row.sharedWith === 'teams') {
    const teamIds = v.admin ? found.teamIds : await teamsOf(v, found.teamIds);
    if (teamIds.length > 0) shared = { sharedWith: 'teams', teamIds };
  }
  const [row] = await db
    .insert(dashboard)
    .values({
      name: `${found.row.name} (copy)`.slice(0, MAX_NAME),
      description: found.row.description,
      ...shared,
      widgets: found.row.widgets,
      ownerId: v.id,
    })
    .returning({ id: dashboard.id });
  return reread(v, row!.id);
}

// The workspace feedback report: created with `widgets` the first time (owned by no
// one, shared with the workspace); two first opens at once create one.
export async function feedbackDashboard(user: AuthUser, body: unknown): Promise<DashboardDto> {
  const v = await viewer(user);
  const widgets = parseWidgets(fields(body).widgets);
  await db
    .insert(dashboard)
    .values({
      name: 'Feedback',
      systemKey: FEEDBACK_KEY,
      sharedWith: 'workspace',
      widgets,
      ownerId: null,
    })
    .onConflictDoNothing({ target: dashboard.systemKey });
  const [found] = await rows(v, eq(dashboard.systemKey, FEEDBACK_KEY));
  if (!found) throw new HttpError(404, 'Dashboard not found');
  return dto(v, found);
}
