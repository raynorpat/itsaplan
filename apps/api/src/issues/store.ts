import {
  db,
  team as teamTable,
  issue,
  issueLabel,
  workflowState,
  attachment,
  project,
  issueActivity,
} from '@repo/db';
import {
  and,
  eq,
  exists,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { iso, num, HttpError } from '../shared/lib';
import { projectTeamIds } from '../projects/access';
import { milestoneProjectId } from '../projects/milestones';
import { nextStatusTimestamps, type StateType } from './status-timestamps';
import type { TeamRow } from '../teams/store';
import {
  recordActivity,
  logIssueUpdate,
  labelNames,
  type ActivityInput,
  type IssueSnapshot,
} from './activity';
import { mapAttachment, type AttachmentRow } from '../attachments/store';
import { notifyIssueChange } from '../notifications/store';
import { assertDelegate, bestEffort, issueDelegated } from '../agents/store';
import {
  currentImport,
  currentWorkflow,
  withoutWorkflows,
  workflowsSkipped,
} from '../shared/workflow-context';
import { subscribe } from '../notifications/subscriptions';
import { emitEvent, isWatched } from '../webhooks/event';
import { issueData, type WebhookData } from '../webhooks/data';
import { assertLabelsApplicable } from '../labels/store';
import { assertCycleOfTeam, autoAssignCycleId } from '../cycles/store';

import { getMembership } from '../members/store';
import { isAppUser } from '../shared/access';

// Data access for issues and their per-issue data (labels). The human identifier (e.g. "MKT-42") is the team key
// plus the issue's team-scoped sequence number.

export interface IssueRow {
  id: string;
  teamId: string;
  // Team-scoped sequence number (the "42" in "MKT-42"). Used to address the
  // issue by its human number in URLs (/team/MKT/issue/42).
  sequenceNumber: number;
  identifier: string;
  // The project this issue is linked to, expanded to id + title for rendering,
  // or null. Filled by attachProjects; mapIssue alone leaves it null.
  project: { id: string; title: string } | null;
  cycleId: string | null;
  assigneeUserId: string | null;
  delegateUserId: string | null;
  stateId: string;
  // Parent issue id (sub-issues), or null for a top-level issue.
  parentId: string | null;
  // The project milestone, which belongs to the issue's project; or null.
  projectMilestoneId: string | null;
  creatorUserId: string | null;
  title: string;
  description: string;
  priority: number;
  estimate: number | null;
  dueDate: string | null;
  position: number;
  // Status timestamps, kept in step with the column type (see status-timestamps.ts).
  startedAt: string | null;
  completedAt: string | null;
  canceledAt: string | null;
  createdAt: string;
  updatedAt: string;
  // When the issue was archived (hidden from the board but kept), or null when it
  // is active. Set by the archive action or the worker's auto-archive sweep.
  archivedAt: string | null;
  labelIds: string[];
}

function mapIssue(row: typeof issue.$inferSelect, teamKey: string): IssueRow {
  return {
    id: row.id,
    teamId: row.teamId,
    sequenceNumber: row.sequenceNumber,
    identifier: `${teamKey}-${row.sequenceNumber}`,
    project: null,
    assigneeUserId: row.assigneeUserId,
    delegateUserId: row.delegateUserId,
    stateId: row.stateId,
    parentId: row.parentId,
    projectMilestoneId: row.projectMilestoneId,
    cycleId: row.cycleId,
    creatorUserId: row.creatorUserId,
    title: row.title,
    description: row.description,
    priority: row.priority,
    estimate: row.estimate,
    dueDate: row.dueDate,
    position: num(row.position),
    startedAt: row.startedAt ? iso(row.startedAt) : null,
    completedAt: row.completedAt ? iso(row.completedAt) : null,
    canceledAt: row.canceledAt ? iso(row.canceledAt) : null,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    archivedAt: row.archivedAt ? iso(row.archivedAt) : null,
    labelIds: [],
  };
}

// The subset of issue columns the change log diffs.
function snapshot(row: IssueRow): IssueSnapshot {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    stateId: row.stateId,
    projectId: row.project?.id ?? null,
    cycleId: row.cycleId,
    assigneeUserId: row.assigneeUserId,
    delegateUserId: row.delegateUserId,
    parentId: row.parentId,
    priority: row.priority,
    dueDate: row.dueDate,
  };
}

export async function listIssues(team: TeamRow): Promise<IssueRow[]> {
  const rows = await db
    .select()
    .from(issue)
    .where(and(eq(issue.teamId, team.id), isNull(issue.archivedAt)))
    .orderBy(issue.stateId, issue.position);
  const issues = rows.map((row) => mapIssue(row, team.key));
  await attachLabels(issues);
  await attachProjects(issues);
  return issues;
}

// A light issue result for search and list: the fields the command palette and the
// search_issues / list_issues MCP tools need to list and open a match. No
// description (which may embed large data URIs), so the payload stays small.
export interface IssueSearchHit {
  id: string;
  sequenceNumber: number;
  identifier: string;
  title: string;
  stateId: string;
  projectId: string | null;
  assigneeUserId: string | null;
  delegateUserId: string | null;
  priority: number;
  dueDate: string | null;
  labelIds: string[];
  archived: boolean;
}

// Escapes LIKE metacharacters so the query is matched literally (Postgres LIKE uses
// '\' as the default escape character).
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

// Filters of searchIssues. query is case-insensitive text; the rest are exact
// matches (null matches an unset field; every label must be on the issue).
export interface IssueQuery {
  query?: string;
  stateId?: string;
  projectId?: string | null;
  assigneeUserId?: string | null;
  delegateUserId?: string | null;
  priority?: number;
  labelIds?: string[];
  dueFrom?: string;
  dueTo?: string;
  limit?: number;
}

// Server-side issue read backing two routes: text search (search_issues) and the
// filtered list (list_issues). Text search (filters.query) matches, case-
// insensitively, the title, description, the issue number (a bare number, or
// "KEY-42" for this team). The other fields apply as exact filters (used
// by list_issues). includeArchived adds archived issues to the result (search always
// sets it; list defaults to active only).
export async function searchIssues(
  team: TeamRow,
  filters: IssueQuery,
  opts: { includeArchived?: boolean } = {},
): Promise<IssueSearchHit[]> {
  const conds: SQL[] = [eq(issue.teamId, team.id)];
  if (!opts.includeArchived) conds.push(isNull(issue.archivedAt));

  const raw = filters.query?.trim();
  let seqMatch: number | null = null;
  if (raw) {
    const pattern = `%${escapeLike(raw)}%`;
    // Recognise the issue number: a bare number, or "KEY-42" whose key matches this
    // team. Matched against sequence_number (the identifier is not a column).
    if (/^\d+$/.test(raw)) {
      seqMatch = Number(raw);
    } else {
      const m = raw.match(/^([A-Za-z][A-Za-z0-9]*)-(\d+)$/);
      if (m && m[1].toLowerCase() === team.key.toLowerCase()) seqMatch = Number(m[2]);
    }
    const textConds: SQL[] = [ilike(issue.title, pattern), ilike(issue.description, pattern)];
    if (seqMatch !== null) textConds.push(eq(issue.sequenceNumber, seqMatch));
    conds.push(or(...textConds)!);
  }

  // Exact filters, mirroring matchesIssue: undefined skips the filter, null matches
  // rows where the column is null, a value matches equality.
  if (filters.stateId !== undefined) conds.push(eq(issue.stateId, filters.stateId));
  if (filters.projectId !== undefined)
    conds.push(
      filters.projectId === null ? isNull(issue.projectId) : eq(issue.projectId, filters.projectId),
    );
  if (filters.assigneeUserId !== undefined)
    conds.push(
      filters.assigneeUserId === null
        ? isNull(issue.assigneeUserId)
        : eq(issue.assigneeUserId, filters.assigneeUserId),
    );
  if (filters.delegateUserId !== undefined)
    conds.push(
      filters.delegateUserId === null
        ? isNull(issue.delegateUserId)
        : eq(issue.delegateUserId, filters.delegateUserId),
    );
  if (filters.priority !== undefined) conds.push(eq(issue.priority, filters.priority));
  // labelIds is AND: the issue must carry every supplied label.
  for (const labelId of filters.labelIds ?? []) {
    conds.push(
      exists(
        db
          .select({ one: sql`1` })
          .from(issueLabel)
          .where(and(eq(issueLabel.issueId, issue.id), eq(issueLabel.labelId, labelId))),
      ),
    );
  }
  // A null due date never falls in a range, so gte/lte alone exclude it.
  if (filters.dueFrom !== undefined) conds.push(gte(issue.dueDate, filters.dueFrom));
  if (filters.dueTo !== undefined) conds.push(lte(issue.dueDate, filters.dueTo));

  // Exact number match first (if any), then most recently updated.
  const orderBy =
    seqMatch !== null
      ? [
          sql`case when ${issue.sequenceNumber} = ${seqMatch} then 0 else 1 end`,
          sql`${issue.updatedAt} desc`,
        ]
      : [sql`${issue.updatedAt} desc`];

  const base = db
    .select({
      id: issue.id,
      sequenceNumber: issue.sequenceNumber,
      projectId: issue.projectId,
      assigneeUserId: issue.assigneeUserId,
      delegateUserId: issue.delegateUserId,
      stateId: issue.stateId,
      title: issue.title,
      priority: issue.priority,
      dueDate: issue.dueDate,
      archivedAt: issue.archivedAt,
    })
    .from(issue)
    .where(and(...conds))
    .orderBy(...orderBy);
  const rows = filters.limit !== undefined ? await base.limit(filters.limit) : await base;

  const hits: IssueSearchHit[] = rows.map((r) => ({
    id: r.id,
    sequenceNumber: r.sequenceNumber,
    identifier: `${team.key}-${r.sequenceNumber}`,
    title: r.title,
    stateId: r.stateId,
    projectId: r.projectId,
    assigneeUserId: r.assigneeUserId,
    delegateUserId: r.delegateUserId,
    priority: r.priority,
    dueDate: r.dueDate,
    labelIds: [],
    archived: r.archivedAt !== null,
  }));
  await attachLabels(hits);
  return hits;
}

// Archives an issue: sets archived_at so it drops off the board and lists, keeping
// the row for restore. Idempotent (archiving an archived issue is a no-op re-stamp
// avoided by the archived_at guard). Records a feed entry. Returns the updated
// issue, or null if it does not exist.
export async function archiveIssue(
  id: string,
  actorUserId?: string | null,
): Promise<IssueRow | null> {
  const beforeData = await watchedIssueData(id);
  const [row] = await db
    .update(issue)
    .set({ archivedAt: sql`now()`, updatedAt: sql`now()` })
    .where(and(eq(issue.id, id), isNull(issue.archivedAt)))
    .returning({ id: issue.id });
  if (!row) {
    // Either not found, or already archived. Distinguish so a missing issue 404s.
    return getIssue(id);
  }
  await recordActivity(id, [{ action: 'archived' }], actorUserId);
  const archived = await getIssue(id);
  if (archived) await emitIssue('update', id, archived.teamId, actorUserId, beforeData);
  return archived;
}

// Restores an archived issue back onto the board (archived_at -> null). Records a
// feed entry. If its column was archived meanwhile, the issue moves to the first
// active column of the same state type (archiveState keeps one per type), so it
// never sits in a hidden column. Returns the updated issue, or null if it does not
// exist.
export async function restoreIssue(
  id: string,
  actorUserId?: string | null,
): Promise<IssueRow | null> {
  const beforeData = await watchedIssueData(id);
  const [row] = await db
    .update(issue)
    .set({ archivedAt: null, updatedAt: sql`now()` })
    .where(and(eq(issue.id, id), isNotNull(issue.archivedAt)))
    .returning({ id: issue.id, stateId: issue.stateId, teamId: issue.teamId });
  if (!row) return getIssue(id);
  await recordActivity(id, [{ action: 'restored' }], actorUserId);
  const [column] = await db
    .select({ archivedAt: workflowState.archivedAt, stateType: workflowState.stateType })
    .from(workflowState)
    .where(eq(workflowState.id, row.stateId));
  if (column?.archivedAt) {
    const [target] = await db
      .select({ id: workflowState.id })
      .from(workflowState)
      .where(
        and(
          eq(workflowState.teamId, row.teamId),
          eq(workflowState.stateType, column.stateType),
          isNull(workflowState.archivedAt),
        ),
      )
      .orderBy(workflowState.position)
      .limit(1);
    // One webhook update covers the restore and the move.
    if (target)
      return withoutWorkflows(() =>
        updateIssue(id, { stateId: target.id }, actorUserId, { before: beforeData }),
      );
  }
  await emitIssue('update', id, row.teamId, actorUserId, beforeData);
  return getIssue(id);
}

// Expands each issue's linked project to { id, title } in place, in one query
// joining the issue to its project. Issues with no project keep the null
// mapIssue set. Rendering the project name on a board card needs no separate
// scaffold lookup this way.
async function attachProjects(issues: IssueRow[]): Promise<void> {
  if (issues.length === 0) return;
  const rows = await db
    .select({ issueId: issue.id, id: project.id, title: project.name })
    .from(issue)
    .innerJoin(project, eq(project.id, issue.projectId))
    .where(
      inArray(
        issue.id,
        issues.map((i) => i.id),
      ),
    );
  const byIssue = new Map<string, { id: string; title: string }>();
  for (const r of rows) byIssue.set(r.issueId, { id: r.id, title: r.title });
  for (const i of issues) i.project = byIssue.get(i.id) ?? null;
}

// Loads every issue's label ids and merges them onto the issues in place. Generic
// so it also enriches the lighter IssueSearchHit rows, which carry id + labelIds.
async function attachLabels<T extends { id: string; labelIds: string[] }>(
  issues: T[],
): Promise<void> {
  if (issues.length === 0) return;
  const rows = await db
    .select({ issueId: issueLabel.issueId, labelId: issueLabel.labelId })
    .from(issueLabel)
    .where(
      inArray(
        issueLabel.issueId,
        issues.map((i) => i.id),
      ),
    );
  const byIssue = new Map<string, string[]>();
  for (const r of rows) {
    let list = byIssue.get(r.issueId);
    if (!list) byIssue.set(r.issueId, (list = []));
    list.push(r.labelId);
  }
  for (const i of issues) i.labelIds = byIssue.get(i.id) ?? [];
}

// The snapshot columns of an issue, without the label and team-key joins a
// full load does. Used as the "before" state for the change-log diff, which
// needs only these columns, plus the team id the update's scope checks run
// against.
async function loadSnapshot(id: string): Promise<(IssueSnapshot & { teamId: string }) | null> {
  const rows = await db
    .select({
      id: issue.id,
      teamId: issue.teamId,
      title: issue.title,
      description: issue.description,
      stateId: issue.stateId,
      projectId: issue.projectId,
      cycleId: issue.cycleId,
      assigneeUserId: issue.assigneeUserId,
      delegateUserId: issue.delegateUserId,
      parentId: issue.parentId,
      priority: issue.priority,
      dueDate: issue.dueDate,
    })
    .from(issue)
    .where(eq(issue.id, id));
  return rows[0] ?? null;
}

export async function getIssue(id: string): Promise<IssueRow | null> {
  const rows = await db
    .select({ issue, teamKey: teamTable.key })
    .from(issue)
    .innerJoin(teamTable, eq(teamTable.id, issue.teamId))
    .where(eq(issue.id, id));
  if (!rows[0]) return null;
  const mapped = mapIssue(rows[0].issue, rows[0].teamKey);
  await attachLabels([mapped]);
  await attachProjects([mapped]);
  return mapped;
}

// The team an issue belongs to, or null if the issue does not exist. Used by
// the access check on routes that address an issue by its own id.
export async function getIssueTeamId(id: string): Promise<string | null> {
  const rows = await db.select({ teamId: issue.teamId }).from(issue).where(eq(issue.id, id));
  return rows[0]?.teamId ?? null;
}

export interface NewIssueInput {
  projectId?: string | null;
  projectMilestoneId?: string | null;
  cycleId?: string | null;
  assigneeUserId?: string | null;
  delegateUserId?: string | null;
  stateId: string;
  title: string;
  description?: string;
  priority?: number;
  estimate?: number | null;
  parentId?: string | null;
  dueDate?: string | null;
  labelIds?: string[];
  // Sort position in the column; defaults to after the column's last issue.
  position?: number;
  // Linear's subscriberIds: subscribed with the creator and the assignee. The caller
  // checks they are team members.
  subscriberIds?: string[];
}

// Enforces that the assignee is a team member and the delegate an installed agent
// (assertDelegate). Only checks the fields present in the patch, and only when set
// to a non-null value (clearing a field is always allowed). Throws 400 otherwise.
export async function assertAssignments(
  teamId: string,
  patch: { assigneeUserId?: string | null; delegateUserId?: string | null },
): Promise<void> {
  if (patch.assigneeUserId) {
    const role = await getMembership(teamId, patch.assigneeUserId);
    if (!role) throw new HttpError(400, 'Assignee must be a team member');
    // Linear keeps a person as the assignee and makes an app user the delegate.
    if (await isAppUser(patch.assigneeUserId))
      throw new HttpError(400, 'An application cannot be the assignee; delegate the issue to it');
  }
  if (patch.delegateUserId) await assertDelegate(teamId, patch.delegateUserId);
}

// Enforces that a milestone belongs to the issue's (resulting) project. Only
// checks when set to a non-null value. Throws 400 otherwise.
async function assertMilestone(
  projectId: string | null,
  milestoneId: string | null | undefined,
): Promise<void> {
  if (!milestoneId) return;
  if (!projectId || (await milestoneProjectId(milestoneId)) !== projectId)
    throw new HttpError(400, "The milestone must belong to the issue's project");
}

// Enforces that the project includes the issue's team and is not deleted (in the
// trash) or archived. `current` is the issue's project before the change: keeping an
// issue in a project that was deleted since is allowed. Throws 400 otherwise.
export async function assertProject(
  teamId: string,
  projectId: string | null | undefined,
  current: string | null = null,
): Promise<void> {
  if (projectId == null) return;
  if (!(await projectTeamIds(projectId)).includes(teamId))
    throw new HttpError(400, "The project must include the issue's team");
  if (projectId === current) return;
  const [row] = await db
    .select({ archivedAt: project.archivedAt })
    .from(project)
    .where(eq(project.id, projectId));
  if (row?.archivedAt) throw new HttpError(400, 'The project is deleted or archived');
}

// Enforces that a column belongs to the issue's team and is not archived —
// issue.state_id only requires the column to exist somewhere, so an issue could
// otherwise sit on another team's board. Throws 400 otherwise. Returns the
// column's state type, or null when no column is given.
export async function assertColumn(
  teamId: string,
  stateId: string | undefined,
): Promise<StateType | null> {
  if (stateId === undefined) return null;
  const rows = await db
    .select({ stateType: workflowState.stateType, archivedAt: workflowState.archivedAt })
    .from(workflowState)
    .where(and(eq(workflowState.id, stateId), eq(workflowState.teamId, teamId)));
  if (rows.length === 0) throw new HttpError(400, 'Column must belong to this team');
  if (rows[0].archivedAt) throw new HttpError(400, 'Column is archived');
  return rows[0].stateType as StateType;
}

// Enforces that a parent issue is in the same team and is neither the issue
// itself nor one of its descendants (which would make a cycle). Only checks when
// set to a non-null value. issueId is null on create. Throws 400 otherwise.
async function assertParent(
  teamId: string,
  issueId: string | null,
  parentId: string | null | undefined,
): Promise<void> {
  if (!parentId) return;
  if (parentId === issueId) throw new HttpError(400, 'An issue cannot be its own parent');
  const rows = await db
    .select({ id: issue.id })
    .from(issue)
    .where(and(eq(issue.id, parentId), eq(issue.teamId, teamId)));
  if (rows.length === 0) throw new HttpError(400, 'Parent issue must belong to this team');
  if (!issueId) return;
  // Walk up from the proposed parent; reaching the issue means a cycle.
  const ancestors = (await db.execute(sql`
    WITH RECURSIVE up(id, parent_id) AS (
      SELECT id, parent_id FROM issue WHERE id = ${parentId}
      UNION
      SELECT i.id, i.parent_id FROM issue i JOIN up ON i.id = up.parent_id
    )
    SELECT 1 FROM up WHERE id = ${issueId} LIMIT 1
  `)) as unknown as unknown[];
  if (ancestors.length > 0) throw new HttpError(400, 'Parent cannot be a sub-issue of this issue');
}

// The issue's webhook data, or null when no webhook receives Issue events of its
// team (so nothing is built for a later event).
async function watchedIssueData(issueId: string, teamId?: string | null) {
  const team = teamId ?? (await getIssueTeamId(issueId));
  if (!team || !(await isWatched('Issue', [team]))) return null;
  return issueData(issueId);
}

// The ids of the labels on an issue.
async function issueLabelIds(issueId: string): Promise<string[]> {
  const rows = await db
    .select({ labelId: issueLabel.labelId })
    .from(issueLabel)
    .where(eq(issueLabel.issueId, issueId));
  return rows.map((r) => r.labelId);
}

// The workflow automation engine (workflows/engine.ts), registered at startup. It
// imports this store to apply a rule's changes, so the store reaches it through this
// hook instead of importing it. `before` runs ahead of a person's update and returns
// what the engine needs to see which rules started matching; the after calls run the
// rules. Workflow writes and system writes (workflowsSkipped) run no rules.
export interface IssueRuleHook {
  before(issueId: string, teamId: string): Promise<unknown>;
  // Whether a rule ran (and so changed the issue).
  afterUpdate(state: unknown, issueId: string): Promise<boolean>;
  afterCreate(issueId: string, teamId: string): Promise<boolean>;
}

let ruleHook: IssueRuleHook | null = null;

export function setIssueRuleHook(hook: IssueRuleHook | null): void {
  ruleHook = hook;
}

// The rule state ahead of an update, or null when rules do not apply. A failure is
// logged and runs no rules; it never fails the person's change. A caller that writes
// part of the change before calling updateIssue (issueUpdate's subscribers) reads it
// first and passes it as `opts.rules`.
export async function rulesBefore(issueId: string, teamId: string): Promise<unknown> {
  if (!ruleHook || workflowsSkipped()) return null;
  try {
    return await ruleHook.before(issueId, teamId);
  } catch (err) {
    console.error('[workflows] matching rules failed:', err);
    return null;
  }
}

// Who a delegation's agent session is credited to: the person, or for a workflow's
// change the rule's owner.
const sessionCreator = (actorUserId: string | null | undefined) =>
  actorUserId ?? currentWorkflow()?.ownerId ?? null;

// Sends an Issue webhook event with the issue's current data. `before` is the
// issue's data before the change, for an update.
async function emitIssue(
  action: 'create' | 'update',
  issueId: string,
  teamId: string,
  actorUserId: string | null | undefined,
  before?: Record<string, unknown> | null,
): Promise<void> {
  if (!(await isWatched('Issue', [teamId]))) return;
  const data = await issueData(issueId);
  if (!data) return;
  await emitEvent({
    type: 'Issue',
    action,
    teamIds: [teamId],
    actorUserId: actorUserId ?? null,
    data,
    before: before ?? undefined,
  });
}

// Original dates of an imported issue (Linear's IssueCreateInput createdAt /
// completedAt). `closedAt` is the import's close time of a canceled issue and `link`
// the import's link back to the source issue, written in the issue's own transaction
// so an issue an import created always carries it; GraphQL sets neither.
export interface IssueImportDates {
  createdAt?: Date;
  completedAt?: Date;
  closedAt?: Date;
  link?: { url: string; title: string; metadata: Record<string, unknown> };
}

// Linear's rules for the import dates: each in the past, completedAt only with
// createdAt, not before it, and only for a completed state; closedAt only for a
// canceled state, not before createdAt.
export function assertImportDates(
  stateType: string,
  dates: IssueImportDates,
  now: Date = new Date(),
): void {
  const { createdAt, completedAt, closedAt } = dates;
  for (const [name, d] of [
    ['createdAt', createdAt],
    ['completedAt', completedAt],
    ['closedAt', closedAt],
  ] as const)
    if (d && d.getTime() > now.getTime()) throw new HttpError(400, `${name} must be in the past`);
  if (completedAt) {
    if (!createdAt) throw new HttpError(400, 'completedAt requires createdAt');
    if (stateType !== 'completed')
      throw new HttpError(400, 'completedAt requires a completed status');
    if (completedAt.getTime() < createdAt.getTime())
      throw new HttpError(400, 'completedAt must not be before createdAt');
  }
  if (closedAt) {
    if (stateType !== 'canceled') throw new HttpError(400, 'closedAt requires a canceled status');
    if (createdAt && closedAt.getTime() < createdAt.getTime())
      throw new HttpError(400, 'closedAt must not be before createdAt');
  }
}

// Atomic per-team sequence number (the "-42" in "MKT-42"): the UPDATE takes a
// row lock on team, so concurrent createIssue calls for the same team never
// hand out the same number.
export async function createIssue(
  team: TeamRow,
  input: NewIssueInput,
  actorUserId?: string | null,
  dates: IssueImportDates = {},
): Promise<IssueRow> {
  await assertAssignments(team.id, input);
  await assertProject(team.id, input.projectId);
  await assertMilestone(input.projectId ?? null, input.projectMilestoneId);
  await assertCycleOfTeam(team.id, input.cycleId);
  const stateType = (await assertColumn(team.id, input.stateId))!;
  assertImportDates(stateType, dates);
  const cycleId =
    (await autoAssignCycleId(team.id, stateType, null, input.cycleId, new Date())) ??
    input.cycleId ??
    null;
  await assertParent(team.id, null, input.parentId);
  const timestamps = nextStatusTimestamps(
    { startedAt: null, completedAt: null, canceledAt: null },
    stateType,
    dates.completedAt ?? dates.closedAt ?? new Date(),
  );
  // Also checked by setIssueLabels below, but here it fails before the issue exists.
  await assertLabelsApplicable(team.id, input.labelIds ?? []);
  const issueId = await db.transaction(async (tx) => {
    const [seqRow] = await tx
      .update(teamTable)
      .set({ nextSequence: sql`next_sequence + 1` })
      .where(eq(teamTable.id, team.id))
      .returning({ seq: sql<number>`next_sequence - 1` });
    const sequenceNumber = Number(seqRow.seq);
    const [posRow] = await tx
      .select({ pos: sql<number>`COALESCE(MAX(${issue.position}), 0) + 1000` })
      .from(issue)
      .where(eq(issue.stateId, input.stateId));
    const [row] = await tx
      .insert(issue)
      .values({
        teamId: team.id,
        sequenceNumber,
        projectId: input.projectId ?? null,
        projectMilestoneId: input.projectMilestoneId ?? null,
        cycleId,
        assigneeUserId: input.assigneeUserId ?? null,
        delegateUserId: input.delegateUserId ?? null,
        stateId: input.stateId,
        parentId: input.parentId ?? null,
        creatorUserId: actorUserId ?? null,
        title: input.title,
        description: input.description ?? '',
        priority: input.priority ?? 0,
        estimate: input.estimate ?? null,
        ...timestamps,
        dueDate: input.dueDate ?? null,
        position: input.position ?? Number(posRow.pos),
        ...(dates.createdAt ? { createdAt: dates.createdAt, updatedAt: dates.createdAt } : {}),
      })
      .returning({ id: issue.id });
    if (dates.link)
      await tx.insert(attachment).values({
        issueId: row.id,
        url: dates.link.url,
        title: dates.link.title,
        metadata: dates.link.metadata,
        creatorUserId: actorUserId ?? null,
      });
    return row.id;
  });

  const [createdEntry] = await recordActivity(issueId, [{ action: 'created' }], actorUserId);
  // An imported issue's creation entry reads as of its original date and names the
  // import (Linear's IssueHistory.issueImport).
  const importId = currentImport();
  if ((dates.createdAt || importId) && createdEntry)
    await db
      .update(issueActivity)
      .set({
        ...(dates.createdAt ? { createdAt: dates.createdAt } : {}),
        ...(importId ? { issueImportId: importId } : {}),
      })
      .where(eq(issueActivity.id, createdEntry.id));
  // Linear subscribes the creator and the assignee of a new issue.
  await subscribe(
    issueId,
    [actorUserId, input.assigneeUserId, ...(input.subscriberIds ?? [])].filter(
      (id): id is string => !!id,
    ),
  );
  // No separate label event on creation: the initial labels are part of the
  // Issue create payload.
  if (input.labelIds?.length)
    await setIssueLabels(team.id, issueId, input.labelIds, actorUserId, false);
  const created = (await getIssue(issueId))!;
  await emitIssue('create', issueId, team.id, actorUserId);
  if (created.delegateUserId && !currentImport())
    await bestEffort('delegation session', () =>
      issueDelegated(issueId, created.delegateUserId!, sessionCreator(actorUserId)),
    );
  // An issue created already assigned to a member notifies them, the same as
  // assigning one later does.
  if (created.assigneeUserId) {
    await notifyIssueChange({
      teamId: team.id,
      issueId,
      actorUserId: actorUserId ?? null,
      assignedUserId: created.assigneeUserId,
    });
  }
  if (ruleHook && !workflowsSkipped()) {
    const hook = ruleHook;
    let ran = false;
    await bestEffort('workflow rules', async () => {
      ran = await hook.afterCreate(issueId, team.id);
    });
    if (ran) return (await getIssue(issueId)) ?? created;
  }
  return created;
}

export interface IssuePatch {
  stateId?: string;
  position?: number;
  projectId?: string | null;
  projectMilestoneId?: string | null;
  cycleId?: string | null;
  assigneeUserId?: string | null;
  delegateUserId?: string | null;
  title?: string;
  description?: string;
  priority?: number;
  estimate?: number | null;
  parentId?: string | null;
  dueDate?: string | null;
}

// Runs every check updateIssue makes before writing. Throws 400 on a rule
// violation; returns the target state's type, or null when the state is unchanged.
async function checkPatch(
  id: string,
  before: { teamId: string; projectId: string | null },
  patch: IssuePatch,
): Promise<StateType | null> {
  await assertAssignments(before.teamId, patch);
  await assertProject(before.teamId, patch.projectId, before.projectId);
  await assertCycleOfTeam(before.teamId, patch.cycleId);
  const projectAfter = patch.projectId !== undefined ? patch.projectId : before.projectId;
  await assertMilestone(projectAfter, patch.projectMilestoneId);
  const stateType = await assertColumn(before.teamId, patch.stateId);
  await assertParent(before.teamId, id, patch.parentId);
  return stateType;
}

// Checks a patch against an issue without writing, so a batch can reject the
// whole call before its first update. Throws 404 when the issue does not exist.
export async function validateIssuePatch(
  id: string,
  patch: IssuePatch,
  labelIds?: string[],
): Promise<void> {
  const before = await loadSnapshot(id);
  if (!before) throw new HttpError(404, 'Issue not found');
  await checkPatch(id, before, patch);
  if (labelIds) await assertLabelsApplicable(before.teamId, labelIds, await issueLabelIds(id));
}

// opts.labelIds also replaces the issue's labels, so a field and label edit sends
// one Issue webhook update. opts.before is the issue's webhook data from before an
// earlier write of the same change (a restore), which this update's event covers.
export async function updateIssue(
  id: string,
  patch: IssuePatch,
  actorUserId?: string | null,
  opts: { labelIds?: string[]; before?: WebhookData | null; rules?: unknown } = {},
): Promise<IssueRow | null> {
  const before = await loadSnapshot(id);
  if (!before) return null;

  const stateType = await checkPatch(id, before, patch);
  if (patch.stateId !== undefined && patch.stateId !== before.stateId) {
    const assigned = await autoAssignCycleId(
      before.teamId,
      stateType,
      before.cycleId,
      patch.cycleId,
      new Date(),
    );
    if (assigned) patch = { ...patch, cycleId: assigned };
  }
  if (opts.labelIds)
    await assertLabelsApplicable(before.teamId, opts.labelIds, await issueLabelIds(id));
  const beforeData = opts.before ?? (await watchedIssueData(id, before.teamId));
  const rules = 'rules' in opts ? opts.rules : await rulesBefore(id, before.teamId);

  const set: Partial<typeof issue.$inferInsert> = {};
  if (patch.stateId !== undefined) set.stateId = patch.stateId;
  if (patch.position !== undefined) set.position = patch.position;
  if (patch.projectId !== undefined) set.projectId = patch.projectId;
  // Moving the issue to another project (or out of one) clears its milestone,
  // unless the patch sets a milestone of the new project.
  if (patch.projectMilestoneId !== undefined) set.projectMilestoneId = patch.projectMilestoneId;
  else if (patch.projectId !== undefined && patch.projectId !== before.projectId)
    set.projectMilestoneId = null;
  if (patch.cycleId !== undefined) set.cycleId = patch.cycleId;
  if (patch.assigneeUserId !== undefined) set.assigneeUserId = patch.assigneeUserId;
  if (patch.delegateUserId !== undefined) set.delegateUserId = patch.delegateUserId;
  if (patch.title !== undefined) set.title = patch.title;
  if (patch.description !== undefined) set.description = patch.description;
  if (patch.priority !== undefined) set.priority = patch.priority;
  if (patch.estimate !== undefined) set.estimate = patch.estimate;
  if (patch.parentId !== undefined) set.parentId = patch.parentId;
  if (stateType && patch.stateId !== before.stateId) {
    const [prev] = await db
      .select({
        startedAt: issue.startedAt,
        completedAt: issue.completedAt,
        canceledAt: issue.canceledAt,
      })
      .from(issue)
      .where(eq(issue.id, id));
    Object.assign(set, nextStatusTimestamps(prev, stateType, new Date()));
  }
  if (patch.dueDate !== undefined) set.dueDate = patch.dueDate;

  const changed = Object.keys(set).length > 0;
  if (changed) {
    set.updatedAt = sql`now()` as unknown as Date;
    await db.update(issue).set(set).where(eq(issue.id, id));
  }
  if (opts.labelIds) await setIssueLabels(before.teamId, id, opts.labelIds, actorUserId, false);
  const after = await getIssue(id);
  if (after) {
    await logIssueUpdate(before, snapshot(after), actorUserId);
    if (changed || opts.labelIds || opts.before)
      await emitIssue('update', id, after.teamId, actorUserId, beforeData);
    if (after.delegateUserId && after.delegateUserId !== before.delegateUserId)
      await bestEffort('delegation session', () =>
        issueDelegated(id, after.delegateUserId!, sessionCreator(actorUserId)),
      );
  }
  if (after && rules && ruleHook) {
    const hook = ruleHook;
    let ran = false;
    await bestEffort('workflow rules', async () => {
      ran = await hook.afterUpdate(rules, id);
    });
    if (ran) return (await getIssue(id)) ?? after;
  }
  return after;
}

// Deletes an issue and everything attached to it. Labels,
// attachments, and activity all go by their ON DELETE CASCADE on issue_id. Returns
// the deleted file attachment rows (s3Key set) so the caller can remove their objects.
// Returns null if the issue did not exist.
export async function deleteIssue(
  issueId: string,
  actorUserId?: string | null,
): Promise<AttachmentRow[] | null> {
  const beforeData = await watchedIssueData(issueId);
  const result = await db.transaction(async (tx) => {
    const rows = await tx
      .select({ teamId: issue.teamId, seq: issue.sequenceNumber, key: teamTable.key })
      .from(issue)
      .innerJoin(teamTable, eq(teamTable.id, issue.teamId))
      .where(eq(issue.id, issueId));
    if (rows.length === 0) return null;
    const attachmentRows = await tx
      .select()
      .from(attachment)
      .where(and(eq(attachment.issueId, issueId), isNotNull(attachment.s3Key)));
    await tx.delete(issue).where(eq(issue.id, issueId));
    return {
      attachments: attachmentRows.map(mapAttachment),
      teamId: rows[0].teamId,
      identifier: `${rows[0].key}-${rows[0].seq}`,
    };
  });
  if (!result) return null;
  if (beforeData)
    await emitEvent({
      type: 'Issue',
      action: 'remove',
      teamIds: [result.teamId],
      actorUserId: actorUserId ?? null,
      data: beforeData,
    });
  return result.attachments;
}

// Replaces the issue's full label set (not an add/remove diff) and logs the
// added/removed labels to the activity feed. teamId is the issue's team: a
// label outside it is rejected before anything is written.
export async function setIssueLabels(
  teamId: string,
  issueId: string,
  labelIds: string[],
  actorUserId?: string | null,
  sendEvent = true,
): Promise<void> {
  const before = await issueLabelIds(issueId);
  await assertLabelsApplicable(teamId, labelIds, before);
  const beforeData = sendEvent ? await watchedIssueData(issueId, teamId) : null;
  const next = [...new Set(labelIds)];

  await db.delete(issueLabel).where(eq(issueLabel.issueId, issueId));
  if (next.length) {
    await db
      .insert(issueLabel)
      .values(next.map((labelId) => ({ issueId, labelId })))
      .onConflictDoNothing();
  }

  const added = next.filter((x) => !before.includes(x));
  const removed = before.filter((x) => !next.includes(x));

  // Labels show on the board card, so a label change bumps the issue's updated_at,
  // which clients that sync by it read.
  if (added.length > 0 || removed.length > 0) {
    await db
      .update(issue)
      .set({ updatedAt: sql`now()` })
      .where(eq(issue.id, issueId));
  }

  const names = await labelNames(teamId, [...added, ...removed]);
  const events: ActivityInput[] = [];
  for (const labelId of added)
    events.push({ action: 'label_add', toText: names.get(labelId) ?? null, toId: labelId });
  for (const labelId of removed)
    events.push({
      action: 'label_remove',
      fromText: names.get(labelId) ?? null,
      fromId: labelId,
    });
  await recordActivity(issueId, events, actorUserId);

  if (sendEvent && (added.length > 0 || removed.length > 0)) {
    await emitIssue('update', issueId, teamId, actorUserId, beforeData);
  }
}

// --- Bulk actions ----------------------------------------------------------------
// Board multi-select applies one change to many issues at once. Each of these runs
// the single-issue operation per id in the request, so the per-issue side effects
// (activity feed, webhooks) still fire, but the client makes one
// request and refetches the board once instead of N times.
