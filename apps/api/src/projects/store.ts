import {
  db,
  initiativeToProject,
  issue,
  project,
  projectLabel,
  team,
  teamMember,
  projectLabelLink,
  projectMember,
  projectStatus,
  projectTeam,
  user,
  PROJECT_STATUS_IDS,
  type ProjectStatusType,
} from '@repo/db';
import { and, asc, eq, exists, inArray, lt, notInArray, or, sql, type SQL } from 'drizzle-orm';
import { projectTeamIds } from './access';
import { closeProjectHistory, liveProgressMany } from './progress';
import type { Progress } from '../shared/progress';
import { HttpError, iso, num, UUID_RE } from '../shared/lib';
import { NON_GUEST_ROLES, type WorkspaceRole } from '../shared/access';
import { latestHealthFor, type UpdateHealth } from './updates';
import { recordActivity, logProjectUpdate, type ProjectSnapshot } from './activity';
import { recordActivity as recordIssueActivity } from '../issues/activity';
import { emitEvent, isWatched, type WebhookAction } from '../webhooks/event';
import { initiativeData, issueData, projectData, type WebhookData } from '../webhooks/data';
import { sendInitiativeEvent } from '../initiatives/store';
import { recordAudit, type AuditTx } from '../audit/store';
import { shownNameSql } from '../shared/user-name';

// Data access for projects (Linear's Project): a body of work linked to teams
// through project_team. Issues link to a project through issue.project_id.
// status is one of the seeded project statuses, addressed here by its type.
// progress and computed health are derived from the linked issues' states.

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
  // Linear's Project.trashed: true while the project is in the trash, else null.
  trashed: boolean | null;
  createdAt: string;
  updatedAt: string;
  labelIds: string[];
  // Linear's weighted progress and scope (projects/progress.ts).
  weighted: Progress;
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
  weighted: Progress,
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
    trashed: row.trashed,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    labelIds,
    weighted,
    health,
  };
}

// visibleTeamIds limits each project's `teams` to what the viewer can access;
// null lists every team.
async function enrich(
  rows: ProjectSelect[],
  visibleTeamIds: string[] | null,
): Promise<ProjectRow[]> {
  const ids = rows.map((r) => r.row.id);
  const [teams, labels, healths, weighted] = await Promise.all([
    teamsFor(ids, visibleTeamIds),
    labelsFor(ids),
    latestHealthFor(ids),
    liveProgressMany(ids),
  ]);
  return rows.map((r) =>
    mapProject(
      r,
      teams.get(r.row.id) ?? [],
      labels.get(r.row.id) ?? [],
      weighted.get(r.row.id)!,
      healths.get(r.row.id) ?? null,
    ),
  );
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
  memberUserIds?: string[];
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

// Every added member must be able to see the project through one of its teams: a
// member of one of them, or a non-guest when one is public. Members who were
// already on the project are not checked again, so one who lost access does not
// block other edits. Refused users are named for a non-guest actor.
async function assertProjectMembers(
  teamIds: string[],
  userIds: string[],
  currentIds: string[],
  actorUserId?: string | null,
): Promise<void> {
  const ids = [...new Set(userIds)].filter((id) => !currentIds.includes(id));
  if (ids.length === 0) return;
  const malformed = ids.filter((id) => !UUID_RE.test(id));
  if (malformed.length) throw new HttpError(400, `Unknown user: ${malformed.join(', ')}`);
  const canSee = or(
    inArray(
      user.id,
      db
        .select({ id: teamMember.userId })
        .from(teamMember)
        .where(inArray(teamMember.teamId, teamIds)),
    ),
    and(
      inArray(user.workspaceRole, NON_GUEST_ROLES),
      exists(
        db
          .select({ id: team.id })
          .from(team)
          .where(and(inArray(team.id, teamIds), eq(team.visibility, 'public'))),
      ),
    ),
  );
  const rows = await db
    .select({ id: user.id, name: shownNameSql, ok: sql<boolean>`${canSee}` })
    .from(user)
    .where(inArray(user.id, ids));
  const allowed = new Set(rows.filter((r) => r.ok).map((r) => r.id));
  const refused = ids.filter((id) => !allowed.has(id));
  if (refused.length === 0) return;
  const actor = actorUserId
    ? (await db.select({ role: user.workspaceRole }).from(user).where(eq(user.id, actorUserId)))[0]
    : undefined;
  const names = new Map(rows.map((r) => [r.id, r.name]));
  const shown =
    actor && NON_GUEST_ROLES.includes(actor.role as WorkspaceRole)
      ? refused.map((id) => names.get(id) ?? id)
      : refused;
  throw new HttpError(400, `Project members must be able to see the project: ${shown.join(', ')}`);
}

// Adds and removes members so the list matches; members who stay keep their
// position.
async function setProjectMembers(projectId: string, userIds: string[]): Promise<void> {
  const ids = [...new Set(userIds)];
  await db.transaction(async (tx) => {
    await tx
      .delete(projectMember)
      .where(
        and(
          eq(projectMember.projectId, projectId),
          ids.length ? notInArray(projectMember.userId, ids) : undefined,
        ),
      );
    if (ids.length)
      await tx
        .insert(projectMember)
        .values(ids.map((userId) => ({ projectId, userId })))
        .onConflictDoNothing();
  });
}

// Checks the lead, labels and members of a create or patch against the teams the
// project has (or will have, when the same change sets its teams).
export async function assertProjectPatch(
  projectId: string | null,
  teamIds: string[],
  patch: Pick<ProjectPatch, 'leadUserId' | 'labelIds' | 'memberUserIds'>,
  actorUserId?: string | null,
): Promise<void> {
  await assertProjectLead(teamIds, patch.leadUserId);
  await assertProjectLabels(patch.labelIds);
  if (patch.memberUserIds !== undefined)
    await assertProjectMembers(
      teamIds,
      patch.memberUserIds,
      projectId ? await projectMemberIds(projectId) : [],
      actorUserId,
    );
}

// The project's member ids, in the order they were added.
export async function projectMemberIds(projectId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: projectMember.userId })
    .from(projectMember)
    .where(eq(projectMember.projectId, projectId))
    .orderBy(asc(projectMember.createdAt), asc(projectMember.userId));
  return rows.map((r) => r.userId);
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
  await assertProjectPatch(null, teams, input, actorUserId);
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
  if (input.memberUserIds?.length) await setProjectMembers(id, input.memberUserIds);
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
  // Linear's memberIds: replaces the project's members.
  memberUserIds?: string[];
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
  await assertProjectPatch(id, await projectTeamIds(id), patch, actorUserId);
  const beforeData = beforeOverride ?? (await projectData(id));

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
    const closes = (s: string) => s === 'completed' || s === 'canceled';
    if (patch.status !== undefined && closes(patch.status) && !closes(before.status))
      await closeProjectHistory(id, new Date());
    await logProjectUpdate(snapshot(before), snapshot((await getProject(id))!), actorUserId);
  }
  if (patch.labelIds !== undefined) await setProjectLabels(id, patch.labelIds, actorUserId);
  if (patch.memberUserIds !== undefined) await setProjectMembers(id, patch.memberUserIds);
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

// Archives a project or restores it. Restoring also takes it out of the trash.
// Archived projects are hidden from lists unless includeArchived. Returns false when
// the project does not exist.
export async function setProjectArchived(
  id: string,
  archived: boolean,
  actorUserId: string | null,
): Promise<boolean> {
  return setArchiveState(
    id,
    archived ? { archivedAt: sql`now()` } : { archivedAt: null, trashed: null },
    actorUserId,
  );
}

// Moves a project to the trash (Linear's projectDelete): archived and trashed. Its
// issues keep their project link until the project is purged.
export async function trashProject(id: string, actorUserId: string | null): Promise<boolean> {
  return setArchiveState(id, { archivedAt: sql`now()`, trashed: true }, actorUserId, (tx, row) =>
    recordAudit(
      'projectDeleted',
      { entityType: 'project', entityId: row.id, entityIdentifier: row.slugId, name: row.name },
      { tx, actorId: actorUserId },
    ),
  );
}

async function setArchiveState(
  id: string,
  values: { archivedAt: SQL | null; trashed?: true | null },
  actorUserId: string | null,
  audit?: (tx: AuditTx, row: { id: string; name: string; slugId: string }) => Promise<void>,
): Promise<boolean> {
  const beforeData = await projectData(id);
  const rows = await db.transaction(async (tx) => {
    const changed = await tx
      .update(project)
      .set({ ...values, updatedAt: sql`now()` })
      .where(eq(project.id, id))
      .returning({ id: project.id, name: project.name, slugId: project.slugId });
    if (changed[0] && audit) await audit(tx, changed[0]);
    return changed;
  });
  if (rows.length && values.archivedAt !== null) await closeProjectHistory(id, new Date());
  if (rows.length) await emitProject('update', await projectData(id), actorUserId, beforeData);
  return rows.length > 0;
}

// Days a trashed project stays restorable before the worker deletes it.
export const PROJECT_TRASH_DAYS = 30;

// Deletes the projects trashed more than PROJECT_TRASH_DAYS before `now`. A project
// that is only archived is never deleted. Returns how many were deleted.
export async function purgeTrashedProjects(now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - PROJECT_TRASH_DAYS * 24 * 60 * 60 * 1000);
  const due = await db
    .select({ id: project.id })
    .from(project)
    .where(and(eq(project.trashed, true), lt(project.archivedAt, cutoff)));
  for (const { id } of due) await deleteProject(id, null);
  return due.length;
}

// Linked issues keep existing: each loses the project (and its milestone), gets a
// system history entry and an Issue update event. The project's own activity rows,
// team links and label links cascade. Deleting a project removes its initiative
// links (cascade); each initiative it was linked to gets an Initiative update.
async function deleteProject(id: string, actorUserId: string | null): Promise<void> {
  const beforeData = await projectData(id);
  const [named] = await db.select({ name: project.name }).from(project).where(eq(project.id, id));
  const linked = await db
    .select({ id: issue.id, teamId: issue.teamId })
    .from(issue)
    .where(eq(issue.projectId, id));
  const issuesBefore = await Promise.all(
    linked.map(async (i) => ({
      ...i,
      before: (await isWatched('Issue', [i.teamId])) ? await issueData(i.id) : null,
    })),
  );
  if (linked.length)
    await db
      .update(issue)
      .set({ projectId: null, projectMilestoneId: null, updatedAt: sql`now()` })
      .where(eq(issue.projectId, id));
  const links = await db
    .select({ initiativeId: initiativeToProject.initiativeId })
    .from(initiativeToProject)
    .where(eq(initiativeToProject.projectId, id));
  const initiativesBefore = await Promise.all(
    links.map(async (l) => [l.initiativeId, await initiativeData(l.initiativeId)] as const),
  );
  await db.transaction(async (tx) => {
    const [gone] = await tx
      .delete(project)
      .where(eq(project.id, id))
      .returning({ slugId: project.slugId });
    // Only the worker's purge deletes a project for good; it acts for no one.
    if (gone)
      await recordAudit(
        'projectPurged',
        {
          entityType: 'project',
          entityId: id,
          entityIdentifier: gone.slugId,
          name: named?.name ?? null,
        },
        { tx, actorId: actorUserId },
      );
  });
  for (const i of issuesBefore) {
    await recordIssueActivity(
      i.id,
      [{ action: 'project', fromText: named?.name ?? null, fromId: id, toId: null }],
      actorUserId,
    );
    if (!i.before) continue;
    const after = await issueData(i.id);
    if (after)
      await emitEvent({
        type: 'Issue',
        action: 'update',
        teamIds: [i.teamId],
        actorUserId,
        data: after,
        before: i.before,
      });
  }
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
// added/removed labels to the activity feed. Bumps updated_at so clients that sync by
// it see the change.
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
