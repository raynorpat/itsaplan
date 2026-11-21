import {
  db,
  issue,
  project,
  projectLabel,
  projectLabelLink,
  projectStatus,
  projectTeam,
  user,
  workflowState,
  PROJECT_STATUS_IDS,
  type ProjectStatusType,
} from '@repo/db';
import { and, asc, desc, eq, ilike, inArray, isNull, sql } from 'drizzle-orm';
import { getMembership } from '../members/store';
import { HttpError, iso, num } from '../shared/lib';
import { computeHealth, type Health } from './health';
import { recordActivity, logProjectUpdate, type ProjectSnapshot } from './activity';

// Data access for projects (Linear's Project): a body of work linked to teams
// through project_team. Issues link to a project through issue.project_id.
// status is one of the seeded project statuses, addressed here by its type.
// progress and computed health are derived from the linked issues' states.

export interface ProjectProgress {
  completed: number;
  canceled: number;
  total: number;
}

export interface ProjectRow {
  id: string;
  teamId: string;
  name: string;
  description: string;
  content: string;
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
  health: Health | null;
}

const projectColumns = {
  row: project,
  statusType: projectStatus.type,
  // The project's first team (projects are single-team until multi-team lands).
  teamId: sql<string>`(select ${projectTeam.teamId} from ${projectTeam} where ${projectTeam.projectId} = ${project.id} limit 1)`,
};

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

function mapProject(sel: ProjectSelect, labelIds: string[], progress: ProjectProgress): ProjectRow {
  const row = sel.row;
  return {
    id: row.id,
    teamId: sel.teamId,
    name: row.name,
    description: row.description,
    content: row.content,
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
    health: computeHealth({
      ...progress,
      startDate: row.startDate,
      targetDate: row.targetDate,
      createdAt: iso(row.createdAt),
    }),
  };
}

const EMPTY_PROGRESS: ProjectProgress = { completed: 0, canceled: 0, total: 0 };

async function enrich(rows: ProjectSelect[]): Promise<ProjectRow[]> {
  const ids = rows.map((r) => r.row.id);
  const [counts, labels] = await Promise.all([countsFor(ids), labelsFor(ids)]);
  return rows.map((r) =>
    mapProject(r, labels.get(r.row.id) ?? [], counts.get(r.row.id) ?? EMPTY_PROGRESS),
  );
}

// Sortable columns. progress and health are derived per row after the query, so
// they are not sortable at the database level.
export type ProjectSort = 'name' | 'priority' | 'targetDate' | 'lead';

export interface ListProjectsOpts {
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

const inTeam = (teamId: string) =>
  inArray(
    project.id,
    db
      .select({ id: projectTeam.projectId })
      .from(projectTeam)
      .where(eq(projectTeam.teamId, teamId)),
  );

export async function listProjects(
  teamId: string,
  opts: ListProjectsOpts = {},
): Promise<ProjectListPage> {
  const conds = [inTeam(teamId), isNull(project.archivedAt)];
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

  return { items: await enrich(rows), total: Number(total) };
}

export type ProjectStatusCounts = Record<ProjectStatusType | 'total', number>;

// Per-status-type row counts for the team, for the list's status tabs. Kept
// separate from listProjects so the tab counts stay correct under paging.
export async function projectStatusCounts(teamId: string): Promise<ProjectStatusCounts> {
  const rows = await db
    .select({ type: projectStatus.type, c: sql<number>`count(*)` })
    .from(project)
    .innerJoin(projectStatus, eq(projectStatus.id, project.statusId))
    .where(and(inTeam(teamId), isNull(project.archivedAt)))
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

export async function getProject(id: string): Promise<ProjectRow | null> {
  const rows = await selectProjects().where(eq(project.id, id));
  if (!rows[0]) return null;
  return (await enrich(rows))[0]!;
}

// The team a project belongs to, or null if it does not exist. Used by the
// access check on routes that address a project by its own id.
export async function getProjectTeamId(id: string): Promise<string | null> {
  const rows = await db
    .select({ teamId: projectTeam.teamId })
    .from(projectTeam)
    .where(eq(projectTeam.projectId, id))
    .limit(1);
  return rows[0]?.teamId ?? null;
}

export interface NewProjectInput {
  name: string;
  description?: string;
  content?: string;
  status?: ProjectStatusType;
  leadUserId?: string | null;
  priority?: number;
  startDate?: string | null;
  targetDate?: string | null;
  labelIds?: string[];
}

async function assertProjectLead(teamId: string, leadUserId?: string | null): Promise<void> {
  if (!leadUserId) return;
  if (!(await getMembership(teamId, leadUserId))) {
    throw new HttpError(400, 'Project lead must be a team member');
  }
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

export async function createProject(
  teamId: string,
  input: NewProjectInput,
  actorUserId?: string | null,
): Promise<ProjectRow> {
  await assertProjectLead(teamId, input.leadUserId);
  await assertProjectLabels(input.labelIds);
  const id = await db.transaction(async (tx) => {
    const [posRow] = await tx
      .select({ pos: sql<number>`COALESCE(MAX(${project.sortOrder}), 0) + 1000` })
      .from(project)
      .where(inTeam(teamId));
    const [row] = await tx
      .insert(project)
      .values({
        name: input.name,
        description: input.description ?? '',
        content: input.content ?? '',
        statusId: PROJECT_STATUS_IDS[input.status ?? 'backlog'],
        leadUserId: input.leadUserId ?? null,
        creatorUserId: actorUserId ?? null,
        priority: input.priority ?? 0,
        startDate: input.startDate ?? null,
        targetDate: input.targetDate ?? null,
        sortOrder: Number(posRow.pos),
      })
      .returning({ id: project.id });
    await tx.insert(projectTeam).values({ projectId: row.id, teamId });
    return row.id;
  });
  await recordActivity(id, [{ action: 'created' }], actorUserId);
  if (input.labelIds?.length) await setProjectLabels(id, input.labelIds, actorUserId);
  return (await getProject(id))!;
}

export interface ProjectPatch {
  name?: string;
  description?: string;
  content?: string;
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
): Promise<ProjectRow | null> {
  const before = await getProject(id);
  if (!before) return null;
  await assertProjectLead(before.teamId, patch.leadUserId);
  await assertProjectLabels(patch.labelIds);

  const set: Partial<typeof project.$inferInsert> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.description !== undefined) set.description = patch.description;
  if (patch.content !== undefined) set.content = patch.content;
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
  return getProject(id);
}

// Linked issues keep existing (issue.project_id is set null by the FK); the
// project's own activity rows, team links and label links cascade.
export async function deleteProject(id: string): Promise<void> {
  await db.delete(project).where(eq(project.id, id));
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
    events.push({ action: 'label_add', toText: names.get(labelId) ?? null });
  for (const labelId of removed)
    events.push({ action: 'label_remove', fromText: names.get(labelId) ?? null });
  await recordActivity(projectId, events, actorUserId);
}

// One project's change marker: moves on any project-level event, any activity of
// a linked issue, and any in-place edit (updated_at). Clients poll this and
// refetch the detail/feed only when it changes.
export async function projectRev(id: string): Promise<string> {
  const [row] = await db
    .select({
      a: sql<string>`(select count(*) || '-' || coalesce(max(created_at)::text, '') from issue_activity where project_id = ${id} or issue_id in (select id from issue where project_id = ${id}))`,
      u: sql<string>`${project.updatedAt}::text`,
    })
    .from(project)
    .where(eq(project.id, id));
  return row ? `${row.a ?? 0}:${row.u}` : '0:';
}
