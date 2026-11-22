import {
  db,
  initiativeToProject,
  issue,
  project,
  projectLabel,
  team,
  teamMember,
  projectLabelLink,
  projectStatus,
  projectTeam,
  user,
  workflowState,
  PROJECT_STATUS_IDS,
  type ProjectStatusType,
} from '@repo/db';
import { and, asc, desc, eq, ilike, inArray, isNull, sql } from 'drizzle-orm';
import { projectsInTeams, projectTeamIds } from './access';
import { HttpError, iso, num } from '../shared/lib';
import { latestHealthFor, type UpdateHealth } from './updates';
import { recordActivity, logProjectUpdate, type ProjectSnapshot } from './activity';
import { emitEvent, type WebhookAction } from '../webhooks/event';
import { initiativeData, projectData, type WebhookData } from '../webhooks/data';
import { sendInitiativeEvent } from '../initiatives/store';

// Data access for projects (Linear's Project): a body of work linked to teams
// through project_team. Issues link to a project through issue.project_id.
// status is one of the seeded project statuses, addressed here by its type.
// progress and computed health are derived from the linked issues' states.

export interface ProjectProgress {
  completed: number;
  canceled: number;
  total: number;
}

export interface ProjectTeam {
  id: string;
  key: string;
  name: string;
}

export interface ProjectRow {
  id: string;
  // The project's teams the viewer can access (Linear's Project.teams).
  teams: ProjectTeam[];
  name: string;
  description: string;
  content: string;
  color: string | null;
  icon: string | null;
  status: ProjectStatusType;
  statusId: string;
  leadUserId: string | null;
  priority: number;
  startDate: string | null;
  targetDate: string | null;
  sortOrder: number;
  slugId: string;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  labelIds: string[];
  progress: ProjectProgress;
  // The latest project update's health (Linear's Project.health), or null.
  health: UpdateHealth | null;
}

const projectColumns = { row: project, statusType: projectStatus.type };

const selectProjects = () =>
  db
    .select(projectColumns)
    .from(project)
    .innerJoin(projectStatus, eq(projectStatus.id, project.statusId));

type ProjectSelect = Awaited<ReturnType<typeof selectProjects>>[number];

// Issue counts per project, grouped by the linked issues' state type. Empty
// entries (a project with no issues) are absent from the map.
async function countsFor(projectIds: string[]): Promise<Map<string, ProjectProgress>> {
  const out = new Map<string, ProjectProgress>();
  if (projectIds.length === 0) return out;
  const rows = await db
    .select({
      projectId: issue.projectId,
      total: sql<number>`count(*)`,
      completed: sql<number>`count(*) filter (where ${workflowState.stateType} = 'completed')`,
      canceled: sql<number>`count(*) filter (where ${workflowState.stateType} = 'canceled')`,
    })
    .from(issue)
    .innerJoin(workflowState, eq(workflowState.id, issue.stateId))
    .where(inArray(issue.projectId, projectIds))
    .groupBy(issue.projectId);
  for (const r of rows) {
    if (r.projectId == null) continue;
    out.set(r.projectId, {
      total: Number(r.total),
      completed: Number(r.completed),
      canceled: Number(r.canceled),
    });
  }
  return out;
}

// Label ids per project, in one query.
async function labelsFor(projectIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (projectIds.length === 0) return out;
  const rows = await db
    .select({ projectId: projectLabelLink.projectId, labelId: projectLabelLink.labelId })
    .from(projectLabelLink)
    .where(inArray(projectLabelLink.projectId, projectIds));
  for (const r of rows) {
    const list = out.get(r.projectId);
    if (list) list.push(r.labelId);
    else out.set(r.projectId, [r.labelId]);
  }
  return out;
}

// The teams of each project, limited to `visibleTeamIds` when given.
async function teamsFor(
  projectIds: string[],
  visibleTeamIds: string[] | null,
): Promise<Map<string, ProjectTeam[]>> {
  const out = new Map<string, ProjectTeam[]>();
  if (projectIds.length === 0) return out;
  const rows = await db
    .select({ projectId: projectTeam.projectId, id: team.id, key: team.key, name: team.name })
    .from(projectTeam)
    .innerJoin(team, eq(team.id, projectTeam.teamId))
    .where(inArray(projectTeam.projectId, projectIds))
    .orderBy(team.key);
  for (const r of rows) {
    if (visibleTeamIds && !visibleTeamIds.includes(r.id)) continue;
    const list = out.get(r.projectId) ?? [];
    list.push({ id: r.id, key: r.key, name: r.name });
    out.set(r.projectId, list);
  }
  return out;
}

function mapProject(
  sel: ProjectSelect,
  teams: ProjectTeam[],
  labelIds: string[],
  progress: ProjectProgress,
  health: UpdateHealth | null,
): ProjectRow {
  const row = sel.row;
  return {
    id: row.id,
    teams,
    name: row.name,
    description: row.description,
    content: row.content,
    color: row.color,
    icon: row.icon,
    status: sel.statusType as ProjectStatusType,
    statusId: row.statusId,
    leadUserId: row.leadUserId,
    priority: row.priority,
    startDate: row.startDate,
    targetDate: row.targetDate,
    sortOrder: num(row.sortOrder),
    slugId: row.slugId,
    archivedAt: row.archivedAt ? iso(row.archivedAt) : null,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    labelIds,
    progress,
    health,
  };
}

const EMPTY_PROGRESS: ProjectProgress = { completed: 0, canceled: 0, total: 0 };

// visibleTeamIds limits each project's `teams` to what the viewer can access;
// null lists every team.
async function enrich(
  rows: ProjectSelect[],
  visibleTeamIds: string[] | null,
): Promise<ProjectRow[]> {
  const ids = rows.map((r) => r.row.id);
  const [teams, counts, labels, healths] = await Promise.all([
    teamsFor(ids, visibleTeamIds),
    countsFor(ids),
    labelsFor(ids),
    latestHealthFor(ids),
  ]);
  return rows.map((r) =>
    mapProject(
      r,
      teams.get(r.row.id) ?? [],
      labels.get(r.row.id) ?? [],
      counts.get(r.row.id) ?? EMPTY_PROGRESS,
      healths.get(r.row.id) ?? null,
    ),
  );
}

// Sortable columns. progress and health are derived per row after the query, so
// they are not sortable at the database level.
export type ProjectSort = 'name' | 'priority' | 'targetDate' | 'lead';

export interface ListProjectsOpts {
  // Only projects of this team (it must be one of the readable teams).
  teamId?: string;
  includeArchived?: boolean;
  statuses?: ProjectStatusType[];
  search?: string;
  sort?: ProjectSort;
  dir?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface ProjectListPage {
  items: ProjectRow[];
  total: number;
}

// Priority sorts urgent (1) → low (4), with "no priority" (0) last.
const PRIORITY_ORDER = sql`case when ${project.priority} = 0 then 5 else ${project.priority} end`;

function orderExpr(sort: ProjectSort) {
  switch (sort) {
    case 'name':
      return project.name;
    case 'priority':
      return PRIORITY_ORDER;
    case 'targetDate':
      return project.targetDate;
    case 'lead':
      // Sort by the lead's display name, not the opaque user id.
      return sql`(select ${user.name} from ${user} where ${user.id} = ${project.leadUserId})`;
  }
}

// The projects of the readable teams, narrowed to opts.teamId when given.
function scope(readableTeamIds: string[], opts: { teamId?: string; includeArchived?: boolean }) {
  const teams = opts.teamId ? readableTeamIds.filter((t) => t === opts.teamId) : readableTeamIds;
  return and(
    inArray(project.id, projectsInTeams(teams)),
    opts.includeArchived ? undefined : isNull(project.archivedAt),
  );
}

// The projects visible through readableTeamIds (the viewer's teams granting
// projects.read), filtered, sorted and paged.
export async function listProjects(
  readableTeamIds: string[],
  opts: ListProjectsOpts = {},
): Promise<ProjectListPage> {
  const conds = [scope(readableTeamIds, opts)];
  if (opts.statuses && opts.statuses.length) {
    conds.push(inArray(projectStatus.type, opts.statuses));
  }
  if (opts.search && opts.search.trim()) {
    conds.push(ilike(project.name, `%${opts.search.trim()}%`));
  }
  const where = and(...conds);

  // A chosen sort orders by that column (nulls last); the default is the manual
  // sort order. Newest first (created_at, then id) breaks ties for a stable page order.
  const orderBy = opts.sort
    ? [
        sql`${orderExpr(opts.sort)} ${opts.dir === 'desc' ? sql`desc` : sql`asc`} nulls last`,
        desc(project.createdAt),
        desc(project.id),
      ]
    : [asc(project.sortOrder), desc(project.createdAt), desc(project.id)];

  const q = selectProjects()
    .where(where)
    .orderBy(...orderBy);
  const rows =
    opts.limit !== undefined ? await q.limit(opts.limit).offset(opts.offset ?? 0) : await q;

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)` })
    .from(project)
    .innerJoin(projectStatus, eq(projectStatus.id, project.statusId))
    .where(where);

  return { items: await enrich(rows, readableTeamIds), total: Number(total) };
}

export type ProjectStatusCounts = Record<ProjectStatusType | 'total', number>;

// Per-status-type row counts of the visible projects (optionally of one team), for
// the list's status tabs. Kept separate from listProjects so the tab counts stay
// correct under paging.
export async function projectStatusCounts(
  readableTeamIds: string[],
  teamId?: string,
): Promise<ProjectStatusCounts> {
  const rows = await db
    .select({ type: projectStatus.type, c: sql<number>`count(*)` })
    .from(project)
    .innerJoin(projectStatus, eq(projectStatus.id, project.statusId))
    .where(scope(readableTeamIds, { teamId }))
    .groupBy(projectStatus.type);
  const out: ProjectStatusCounts = {
    total: 0,
    backlog: 0,
    planned: 0,
    started: 0,
    paused: 0,
    completed: 0,
    canceled: 0,
  };
  for (const r of rows) {
    const n = Number(r.c);
    out.total += n;
    out[r.type as ProjectStatusType] = n;
  }
  return out;
}

// Several projects in the order of `ids` (missing ones are skipped); `teams` lists
// only visibleTeamIds when given.
export async function getProjectsByIds(
  ids: string[],
  visibleTeamIds: string[] | null = null,
): Promise<ProjectRow[]> {
  if (ids.length === 0) return [];
  const rows = await selectProjects().where(inArray(project.id, ids));
  const byId = new Map((await enrich(rows, visibleTeamIds)).map((p) => [p.id, p]));
  return ids.map((id) => byId.get(id)).filter((p): p is ProjectRow => p != null);
}

// One project; `teams` lists only visibleTeamIds when given.
export async function getProject(
  id: string,
  visibleTeamIds: string[] | null = null,
): Promise<ProjectRow | null> {
  const rows = await selectProjects().where(eq(project.id, id));
  if (!rows[0]) return null;
  return (await enrich(rows, visibleTeamIds))[0]!;
}

export interface NewProjectInput {
  name: string;
  description?: string;
  content?: string;
  color?: string | null;
  icon?: string | null;
  sortOrder?: number;
  status?: ProjectStatusType;
  leadUserId?: string | null;
  priority?: number;
  startDate?: string | null;
  targetDate?: string | null;
  labelIds?: string[];
}

// The lead must be a member of at least one of the project's teams.
async function assertProjectLead(teamIds: string[], leadUserId?: string | null): Promise<void> {
  if (!leadUserId) return;
  const rows = await db
    .select({ id: teamMember.userId })
    .from(teamMember)
    .where(and(eq(teamMember.userId, leadUserId), inArray(teamMember.teamId, teamIds)))
    .limit(1);
  if (rows.length === 0)
    throw new HttpError(400, "Project lead must be a member of one of the project's teams");
}

// Project labels are workspace-level; a group holds labels and cannot be applied.
async function assertProjectLabels(labelIds?: string[]): Promise<void> {
  const ids = [...new Set(labelIds ?? [])];
  if (ids.length === 0) return;
  const rows = await db
    .select({ id: projectLabel.id })
    .from(projectLabel)
    .where(and(inArray(projectLabel.id, ids), eq(projectLabel.isGroup, false)));
  if (rows.length !== ids.length) throw new HttpError(400, 'Unknown project label');
}

// Creates a project in the given teams (at least one; the route has checked the
// actor's create permission in each).
export async function createProject(
  teamIds: string[],
  input: NewProjectInput,
  actorUserId?: string | null,
): Promise<ProjectRow> {
  const teams = [...new Set(teamIds)];
  if (teams.length === 0) throw new HttpError(400, 'A project needs at least one team');
  await assertProjectLead(teams, input.leadUserId);
  await assertProjectLabels(input.labelIds);
  const id = await db.transaction(async (tx) => {
    const [posRow] = await tx
      .select({ pos: sql<number>`COALESCE(MAX(${project.sortOrder}), 0) + 1000` })
      .from(project);
    const [row] = await tx
      .insert(project)
      .values({
        name: input.name,
        description: input.description ?? '',
        content: input.content ?? '',
        color: input.color ?? null,
        icon: input.icon ?? null,
        statusId: PROJECT_STATUS_IDS[input.status ?? 'backlog'],
        leadUserId: input.leadUserId ?? null,
        creatorUserId: actorUserId ?? null,
        priority: input.priority ?? 0,
        startDate: input.startDate ?? null,
        targetDate: input.targetDate ?? null,
        sortOrder: input.sortOrder || Number(posRow.pos),
      })
      .returning({ id: project.id });
    await tx.insert(projectTeam).values(teams.map((teamId) => ({ projectId: row.id, teamId })));
    return row.id;
  });
  await recordActivity(id, [{ action: 'created' }], actorUserId);
  if (input.labelIds?.length) await setProjectLabels(id, input.labelIds, actorUserId);
  await emitProject('create', await projectData(id), actorUserId);
  return (await getProject(id))!;
}

export interface ProjectPatch {
  name?: string;
  description?: string;
  content?: string;
  color?: string | null;
  icon?: string | null;
  sortOrder?: number;
  status?: ProjectStatusType;
  leadUserId?: string | null;
  priority?: number;
  startDate?: string | null;
  targetDate?: string | null;
  labelIds?: string[];
}

function snapshot(row: ProjectRow): ProjectSnapshot {
  return {
    id: row.id,
    name: row.name,
    content: row.content,
    status: row.status,
    statusId: row.statusId,
    leadUserId: row.leadUserId,
    priority: row.priority,
    startDate: row.startDate,
    targetDate: row.targetDate,
  };
}

// Addressed by its own id (the route's entity guard already resolved the owning
// team and asserted permission). Returns null if the project does not exist,
// which the route maps to a 404.
export async function updateProject(
  id: string,
  patch: ProjectPatch,
  actorUserId?: string | null,
  // The project's webhook data from before an earlier write of the same change
  // (a team change), which this update's event covers.
  beforeOverride?: WebhookData | null,
): Promise<ProjectRow | null> {
  const before = await getProject(id);
  if (!before) return null;
  await assertProjectLead(await projectTeamIds(id), patch.leadUserId);
  const beforeData = beforeOverride ?? (await projectData(id));
  await assertProjectLabels(patch.labelIds);

  const set: Partial<typeof project.$inferInsert> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.description !== undefined) set.description = patch.description;
  if (patch.content !== undefined) set.content = patch.content;
  if (patch.color !== undefined) set.color = patch.color;
  if (patch.icon !== undefined) set.icon = patch.icon;
  if (patch.sortOrder !== undefined) set.sortOrder = patch.sortOrder;
  if (patch.status !== undefined) set.statusId = PROJECT_STATUS_IDS[patch.status];
  if (patch.leadUserId !== undefined) set.leadUserId = patch.leadUserId;
  if (patch.priority !== undefined) set.priority = patch.priority;
  if (patch.startDate !== undefined) set.startDate = patch.startDate;
  if (patch.targetDate !== undefined) set.targetDate = patch.targetDate;

  if (Object.keys(set).length > 0) {
    set.updatedAt = sql`now()` as unknown as Date;
    await db.update(project).set(set).where(eq(project.id, id));
    await logProjectUpdate(snapshot(before), snapshot((await getProject(id))!), actorUserId);
  }
  if (patch.labelIds !== undefined) await setProjectLabels(id, patch.labelIds, actorUserId);
  await emitProject('update', await projectData(id), actorUserId, beforeData);
  return getProject(id);
}

// Replaces the project's teams as the viewer sees them. Teams the viewer cannot
// read are kept. Adding or removing a team needs `editableTeamIds` to include it
// (403 otherwise). A removed team must have no issues in the project, and the
// project keeps at least one team (409 otherwise).
export async function setProjectTeams(
  projectId: string,
  readableTeamIds: string[],
  editableTeamIds: string[],
  requested: string[],
  actorUserId: string | null,
  sendEvent = true,
): Promise<void> {
  const current = await projectTeamIds(projectId);
  const next = new Set(requested);
  const hidden = current.filter((t) => !readableTeamIds.includes(t));
  const added = [...next].filter((t) => !current.includes(t));
  const removed = current.filter((t) => readableTeamIds.includes(t) && !next.has(t));
  for (const t of [...added, ...removed])
    if (!editableTeamIds.includes(t))
      throw new HttpError(403, 'You do not have permission to change this team on the project');
  if (hidden.length + next.size === 0)
    throw new HttpError(409, 'A project needs at least one team');
  const beforeData = await projectData(projectId);
  if (removed.length) {
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(issue)
      .where(and(eq(issue.projectId, projectId), inArray(issue.teamId, removed)));
    if (n > 0)
      throw new HttpError(
        409,
        "Move the team's issues out of the project before removing the team",
      );
  }
  await db.transaction(async (tx) => {
    if (removed.length)
      await tx
        .delete(projectTeam)
        .where(and(eq(projectTeam.projectId, projectId), inArray(projectTeam.teamId, removed)));
    if (added.length)
      await tx.insert(projectTeam).values(added.map((teamId) => ({ projectId, teamId })));
    await tx
      .update(project)
      .set({ updatedAt: sql`now()` })
      .where(eq(project.id, projectId));
  });
  if (sendEvent) await emitProject('update', await projectData(projectId), actorUserId, beforeData);
}

// Sets or clears archived_at. Archived projects are hidden from lists unless
// includeArchived. Returns false when the project does not exist.
export async function setProjectArchived(
  id: string,
  archived: boolean,
  actorUserId: string | null,
): Promise<boolean> {
  const beforeData = await projectData(id);
  const rows = await db
    .update(project)
    .set({ archivedAt: archived ? sql`now()` : null, updatedAt: sql`now()` })
    .where(eq(project.id, id))
    .returning({ id: project.id });
  if (rows.length) await emitProject('update', await projectData(id), actorUserId, beforeData);
  return rows.length > 0;
}

export interface ProjectStatusRow {
  id: string;
  name: string;
  type: ProjectStatusType;
  color: string;
  position: number;
}

// The six seeded project statuses in lifecycle order.
export async function listProjectStatuses(): Promise<ProjectStatusRow[]> {
  const rows = await db.select().from(projectStatus).orderBy(projectStatus.position);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type as ProjectStatusType,
    color: r.color,
    position: num(r.position),
  }));
}

// Linked issues keep existing (issue.project_id is set null by the FK); the
// project's own activity rows, team links and label links cascade.
// Deleting a project removes its initiative links (cascade); each initiative it was
// linked to gets an Initiative update.
export async function deleteProject(id: string, actorUserId: string | null): Promise<void> {
  const beforeData = await projectData(id);
  const links = await db
    .select({ initiativeId: initiativeToProject.initiativeId })
    .from(initiativeToProject)
    .where(eq(initiativeToProject.projectId, id));
  const initiativesBefore = await Promise.all(
    links.map(async (l) => [l.initiativeId, await initiativeData(l.initiativeId)] as const),
  );
  await db.delete(project).where(eq(project.id, id));
  await emitProject('remove', beforeData, actorUserId);
  for (const [initiativeId, before] of initiativesBefore)
    await sendInitiativeEvent('update', initiativeId, actorUserId, before);
}

// Sends a Project webhook event to the webhooks of the project's teams. An update
// also reaches the teams the project had before it (a removed team learns the
// project left it).
async function emitProject(
  action: WebhookAction,
  data: WebhookData | null,
  actorUserId: string | null | undefined,
  before?: WebhookData | null,
): Promise<void> {
  if (!data) return;
  const teamIds = new Set([
    ...((data.teamIds as string[]) ?? []),
    ...((before?.teamIds as string[] | undefined) ?? []),
  ]);
  await emitEvent({
    type: 'Project',
    action,
    teamIds: [...teamIds],
    actorUserId: actorUserId ?? null,
    data,
    before: before ?? undefined,
  });
}

// Replaces the project's full label set (not an add/remove diff) and logs the
// added/removed labels to the activity feed. Bumps updated_at so projectRev moves.
async function setProjectLabels(
  projectId: string,
  labelIds: string[],
  actorUserId?: string | null,
): Promise<void> {
  const beforeRows = await db
    .select({ labelId: projectLabelLink.labelId })
    .from(projectLabelLink)
    .where(eq(projectLabelLink.projectId, projectId));
  const before = beforeRows.map((r) => r.labelId);
  const next = [...new Set(labelIds)];

  await db.delete(projectLabelLink).where(eq(projectLabelLink.projectId, projectId));
  if (next.length) {
    await db
      .insert(projectLabelLink)
      .values(next.map((labelId) => ({ projectId, labelId })))
      .onConflictDoNothing();
  }

  const added = next.filter((x) => !before.includes(x));
  const removed = before.filter((x) => !next.includes(x));
  if (added.length === 0 && removed.length === 0) return;

  await db
    .update(project)
    .set({ updatedAt: sql`now()` })
    .where(eq(project.id, projectId));

  const names = new Map(
    (
      await db
        .select({ id: projectLabel.id, name: projectLabel.name })
        .from(projectLabel)
        .where(inArray(projectLabel.id, [...added, ...removed]))
    ).map((r) => [r.id, r.name]),
  );
  const events = [];
  for (const labelId of added)
    events.push({ action: 'label_add', toText: names.get(labelId) ?? null, toId: labelId });
  for (const labelId of removed)
    events.push({
      action: 'label_remove',
      fromText: names.get(labelId) ?? null,
      fromId: labelId,
    });
  await recordActivity(projectId, events, actorUserId);
}
