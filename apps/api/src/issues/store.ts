import {
  db,
  team as teamTable,
  issue,
  issueActivity,
  issueLabel,
  label,
  workflowState,
  issueType,
  issueFieldValue,
  issueFieldOption,
  issueAttachment,
  customField,
  customFieldOption,
  project,
  projectTeam,
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
import type { IssueQuery } from '../ai-agents/issue-query';
import { iso, num, HttpError } from '../shared/lib';
import { projectTeamIds } from '../projects/access';
import { milestoneProjectId } from '../projects/milestones';
import { nextStatusTimestamps, type StateType } from './status-timestamps';
import type { TeamRow } from '../teams/store';
import { getCustomFieldById, type CustomFieldType } from '../custom-fields/store';
import {
  recordActivity,
  logIssueUpdate,
  labelNames,
  type ActivityInput,
  type IssueSnapshot,
} from './activity';
import { mapAttachment, type AttachmentRow } from '../attachments/store';
import { notifyIssueChange } from '../notifications/store';
import { emitWebhookEvent } from '../webhooks/emit';
import { getAssignTriggerAgent, isTeamAgent } from '../ai-agents/store';
import { deleteThreadsWhere } from '../ai-agents/runtime/memory';

import { getMembership } from '../members/store';
import { enqueueAgentRun } from '../ai-agents/run-queue';

// Data access for issues and their per-issue data: labels, custom field values,
// and selected options. The human identifier (e.g. "MKT-42") is the team key
// plus the issue's team-scoped sequence number.

// Compact custom field value for the work items payload: the scalar value (null for
// select/multi_select and unset fields) and the selected option ids.
export interface IssueFieldValueEntry {
  fieldId: string;
  value: string | number | boolean | null;
  optionIds: string[];
}

export interface IssueRow {
  id: string;
  teamId: string;
  // Team-scoped sequence number (the "42" in "MKT-42"). Used to address the
  // issue by its human number in URLs (/team/MKT/issue/42).
  sequenceNumber: number;
  identifier: string;
  typeId: string | null;
  // The project this issue is linked to, expanded to id + title for rendering,
  // or null. Filled by attachProjects; mapIssue alone leaves it null.
  project: { id: string; title: string } | null;
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
  startDate: string | null;
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
  // When the issue entered its current column: the newest status-change activity,
  // or createdAt when it has never changed column. Lets the board show how long an
  // issue has sat in its current state. Populated by listIssues/getIssue; mapIssue
  // alone leaves it at createdAt.
  statusSince: string;
  // Unguessable token for the public read-only share link, or null when the issue
  // is not shared. Populated by mapIssue from the row.
  shareToken: string | null;
  labelIds: string[];
  // Custom field values set on this issue, one entry per field that has a scalar
  // value or selected options (unset fields are omitted). Included so the planner
  // UI can filter by custom fields without a per-issue fetch. Only listIssues
  // populates this; mapIssue alone leaves it empty.
  fieldValues: IssueFieldValueEntry[];
}

function mapIssue(row: typeof issue.$inferSelect, teamKey: string): IssueRow {
  return {
    id: row.id,
    teamId: row.teamId,
    sequenceNumber: row.sequenceNumber,
    identifier: `${teamKey}-${row.sequenceNumber}`,
    typeId: row.typeId,
    project: null,
    assigneeUserId: row.assigneeUserId,
    delegateUserId: row.delegateUserId,
    stateId: row.stateId,
    parentId: row.parentId,
    projectMilestoneId: row.projectMilestoneId,
    creatorUserId: row.creatorUserId,
    title: row.title,
    description: row.description,
    priority: row.priority,
    estimate: row.estimate,
    startDate: row.startDate,
    dueDate: row.dueDate,
    position: num(row.position),
    startedAt: row.startedAt ? iso(row.startedAt) : null,
    completedAt: row.completedAt ? iso(row.completedAt) : null,
    canceledAt: row.canceledAt ? iso(row.canceledAt) : null,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    archivedAt: row.archivedAt ? iso(row.archivedAt) : null,
    statusSince: iso(row.createdAt),
    shareToken: row.shareToken,
    labelIds: [],
    fieldValues: [],
  };
}

// Sets each issue's statusSince to the newest status-change activity's timestamp,
// leaving the createdAt default (set by mapIssue) for issues that never changed
// column. One grouped query for the whole set. Mutates the passed issues in place.
async function attachStatusSince(issues: IssueRow[]): Promise<void> {
  if (issues.length === 0) return;
  const rows = await db
    .select({
      issueId: issueActivity.issueId,
      // A raw sql aggregate is not mapped to a Date by Drizzle (that mapping is
      // keyed on a column type), so this comes back as the Postgres timestamp
      // string; parse it before iso(), the same way Drizzle decodes a timestamp
      // column.
      lastStatusAt: sql<string | null>`max(${issueActivity.createdAt})`,
    })
    .from(issueActivity)
    .where(
      and(
        inArray(
          issueActivity.issueId,
          issues.map((i) => i.id),
        ),
        eq(issueActivity.action, 'status'),
      ),
    )
    .groupBy(issueActivity.issueId);
  const byIssue = new Map<string, string>();
  for (const r of rows)
    if (r.issueId != null && r.lastStatusAt) byIssue.set(r.issueId, iso(new Date(r.lastStatusAt)));
  for (const i of issues) i.statusSince = byIssue.get(i.id) ?? i.statusSince;
}

// The subset of issue columns the change log diffs.
function snapshot(row: IssueRow): IssueSnapshot {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    stateId: row.stateId,
    typeId: row.typeId,
    projectId: row.project?.id ?? null,
    assigneeUserId: row.assigneeUserId,
    delegateUserId: row.delegateUserId,
    priority: row.priority,
    startDate: row.startDate,
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
  await attachFieldValues(issues);
  await attachStatusSince(issues);
  await attachProjects(issues);
  return issues;
}

// The team's archived issues, newest archived first. The archive view lists
// these so an owner can restore one. Same per-issue enrichment as the board.
export async function listArchivedIssues(team: TeamRow): Promise<IssueRow[]> {
  const rows = await db
    .select()
    .from(issue)
    .where(and(eq(issue.teamId, team.id), isNotNull(issue.archivedAt)))
    .orderBy(sql`${issue.archivedAt} desc`);
  const issues = rows.map((row) => mapIssue(row, team.key));
  await attachLabels(issues);
  await attachFieldValues(issues);
  await attachStatusSince(issues);
  await attachProjects(issues);
  return issues;
}

// A light issue result for search and list: the fields the command palette and the
// agent's search_issues / list_issues tools need to list and open a match. No
// description (which may embed large data URIs) and no field values, so the payload
// stays small.
export interface IssueSearchHit {
  id: string;
  sequenceNumber: number;
  identifier: string;
  title: string;
  stateId: string;
  typeId: string | null;
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

// Server-side issue read backing two routes: text search (search_issues) and the
// filtered list (list_issues). Text search (filters.query) matches, case-
// insensitively, the title, description, the issue number (a bare number, or
// "KEY-42" for this team), scalar custom field text values, and
// select/multi_select option labels. The other fields apply as exact filters (used
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
    const textConds: SQL[] = [
      ilike(issue.title, pattern),
      ilike(issue.description, pattern),
      exists(
        db
          .select({ one: sql`1` })
          .from(issueFieldValue)
          .where(
            and(eq(issueFieldValue.issueId, issue.id), ilike(issueFieldValue.valueText, pattern)),
          ),
      ),
      exists(
        db
          .select({ one: sql`1` })
          .from(issueFieldOption)
          .innerJoin(customFieldOption, eq(customFieldOption.id, issueFieldOption.optionId))
          .where(
            and(eq(issueFieldOption.issueId, issue.id), ilike(customFieldOption.value, pattern)),
          ),
      ),
    ];
    if (seqMatch !== null) textConds.push(eq(issue.sequenceNumber, seqMatch));
    conds.push(or(...textConds)!);
  }

  // Exact filters, mirroring matchesIssue: undefined skips the filter, null matches
  // rows where the column is null, a value matches equality.
  if (filters.stateId !== undefined) conds.push(eq(issue.stateId, filters.stateId));
  if (filters.typeId !== undefined)
    conds.push(filters.typeId === null ? isNull(issue.typeId) : eq(issue.typeId, filters.typeId));
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
      typeId: issue.typeId,
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
    typeId: r.typeId,
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
//
// The agents' conversation threads for the issue are deleted with it. Archiving is
// reversible and this is not: a restored issue starts with empty agent memory.
export async function archiveIssue(
  id: string,
  actorUserId?: string | null,
): Promise<IssueRow | null> {
  const [row] = await db
    .update(issue)
    .set({ archivedAt: sql`now()` })
    .where(and(eq(issue.id, id), isNull(issue.archivedAt)))
    .returning({ id: issue.id });
  if (!row) {
    // Either not found, or already archived. Distinguish so a missing issue 404s.
    return getIssue(id);
  }
  await recordActivity(id, [{ action: 'archived' }], actorUserId);
  await deleteThreadsWhere({ issueId: id });
  return getIssue(id);
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
  const [row] = await db
    .update(issue)
    .set({ archivedAt: null })
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
    if (target) return updateIssue(id, { stateId: target.id }, actorUserId);
  }
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

// Loads every issue's custom field values in two queries (scalar values and
// selected option ids) and merges them onto the issues. A field with no scalar
// value and no options is omitted, so unset fields add nothing to the payload.
// Mutates the passed issues in place.
async function attachFieldValues(issues: IssueRow[]): Promise<void> {
  if (issues.length === 0) return;
  const issueIds = issues.map((i) => i.id);
  const [scalarRows, optionRows] = await Promise.all([
    db
      .select({
        issueId: issueFieldValue.issueId,
        fieldId: issueFieldValue.fieldId,
        valueText: issueFieldValue.valueText,
        valueNumber: issueFieldValue.valueNumber,
        valueBool: issueFieldValue.valueBool,
        valueDate: issueFieldValue.valueDate,
      })
      .from(issueFieldValue)
      .where(inArray(issueFieldValue.issueId, issueIds)),
    db
      .select({
        issueId: issueFieldOption.issueId,
        fieldId: issueFieldOption.fieldId,
        optionId: issueFieldOption.optionId,
      })
      .from(issueFieldOption)
      .where(inArray(issueFieldOption.issueId, issueIds)),
  ]);

  // issueId -> fieldId -> entry, built up from both queries then flushed onto
  // each issue. Keyed maps keep the merge O(rows) rather than O(issues*rows).
  const byIssue = new Map<string, Map<string, IssueFieldValueEntry>>();
  const entryFor = (issueId: string, fieldId: string): IssueFieldValueEntry => {
    let fields = byIssue.get(issueId);
    if (!fields) byIssue.set(issueId, (fields = new Map()));
    let entry = fields.get(fieldId);
    if (!entry) fields.set(fieldId, (entry = { fieldId, value: null, optionIds: [] }));
    return entry;
  };

  for (const row of scalarRows) entryFor(row.issueId, row.fieldId).value = pickScalarValue(row);
  for (const row of optionRows) entryFor(row.issueId, row.fieldId).optionIds.push(row.optionId);

  for (const i of issues) {
    const fields = byIssue.get(i.id);
    if (fields) i.fieldValues = [...fields.values()];
  }
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
      typeId: issue.typeId,
      projectId: issue.projectId,
      assigneeUserId: issue.assigneeUserId,
      delegateUserId: issue.delegateUserId,
      priority: issue.priority,
      startDate: issue.startDate,
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
  await attachStatusSince([mapped]);
  await attachProjects([mapped]);
  return mapped;
}

// Loads an issue by its team-scoped sequence number (the human number in a URL
// like /team/MKT/issue/42). Returns null if the team has no issue with that
// number. Archived issues resolve too, so a link to one still opens.
export async function getIssueBySequence(
  teamId: string,
  sequenceNumber: number,
): Promise<IssueRow | null> {
  const rows = await db
    .select({ issue, teamKey: teamTable.key })
    .from(issue)
    .innerJoin(teamTable, eq(teamTable.id, issue.teamId))
    .where(and(eq(issue.teamId, teamId), eq(issue.sequenceNumber, sequenceNumber)));
  if (!rows[0]) return null;
  const mapped = mapIssue(rows[0].issue, rows[0].teamKey);
  await attachLabels([mapped]);
  await attachStatusSince([mapped]);
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
  typeId?: string | null;
  projectId?: string | null;
  projectMilestoneId?: string | null;
  assigneeUserId?: string | null;
  delegateUserId?: string | null;
  stateId: string;
  title: string;
  description?: string;
  priority?: number;
  estimate?: number | null;
  parentId?: string | null;
  startDate?: string | null;
  dueDate?: string | null;
  labelIds?: string[];
  // Sort position in the column; defaults to after the column's last issue.
  position?: number;
}

// Enforces that assignee holds a team member and delegate holds an agent of the
// same team. Only checks the fields present in the patch, and only when set to a
// non-null value (clearing a field is always allowed). Throws 400 otherwise.
async function assertAssignments(
  teamId: string,
  patch: { assigneeUserId?: string | null; delegateUserId?: string | null },
): Promise<void> {
  if (patch.assigneeUserId) {
    const role = await getMembership(teamId, patch.assigneeUserId);
    if (!role) throw new HttpError(400, 'Assignee must be a team member');
  }
  if (patch.delegateUserId) {
    if (!(await isTeamAgent(teamId, patch.delegateUserId)))
      throw new HttpError(400, 'Delegate must be an agent of this team');
  }
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

// Enforces that the project includes the issue's team. Throws 400 otherwise.
async function assertProject(teamId: string, projectId: string | null | undefined): Promise<void> {
  if (projectId == null) return;
  if (!(await projectTeamIds(projectId)).includes(teamId))
    throw new HttpError(400, "The project must include the issue's team");
}

// Enforces that a column belongs to the issue's team and is not archived —
// issue.state_id only requires the column to exist somewhere, so an issue could
// otherwise sit on another team's board. Throws 400 otherwise. Returns the
// column's state type, or null when no column is given.
async function assertColumn(
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

// Enforces that an issue type belongs to the issue's team. Only checks when set
// to a non-null value (clearing the type is always allowed). Throws 400 otherwise.
async function assertIssueType(teamId: string, typeId: string | null | undefined): Promise<void> {
  if (typeId == null) return;
  const rows = await db
    .select({ id: issueType.id })
    .from(issueType)
    .where(and(eq(issueType.id, typeId), eq(issueType.teamId, teamId)));
  if (rows.length === 0) throw new HttpError(400, 'Issue type must belong to this team');
}

// Enforces that every label belongs to the issue's team — the issue_label
// foreign key only requires the label to exist somewhere. Throws 400 otherwise.
async function assertIssueLabels(teamId: string, labelIds?: string[]): Promise<void> {
  const ids = [...new Set(labelIds ?? [])];
  if (ids.length === 0) return;
  const rows = await db
    .select({ id: label.id })
    .from(label)
    .where(and(eq(label.teamId, teamId), inArray(label.id, ids)));
  if (rows.length !== ids.length) throw new HttpError(400, 'Labels must belong to this team');
}

// Atomic per-team sequence number (the "-42" in "MKT-42"): the UPDATE takes a
// row lock on team, so concurrent createIssue calls for the same team never
// hand out the same number.
export async function createIssue(
  team: TeamRow,
  input: NewIssueInput,
  actorUserId?: string | null,
): Promise<IssueRow> {
  await assertAssignments(team.id, input);
  await assertProject(team.id, input.projectId);
  await assertMilestone(input.projectId ?? null, input.projectMilestoneId);
  const stateType = (await assertColumn(team.id, input.stateId))!;
  await assertParent(team.id, null, input.parentId);
  const timestamps = nextStatusTimestamps(
    { startedAt: null, completedAt: null, canceledAt: null },
    stateType,
    new Date(),
  );
  await assertIssueType(team.id, input.typeId);
  // Also checked by setIssueLabels below, but here it fails before the issue exists.
  await assertIssueLabels(team.id, input.labelIds);
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
        typeId: input.typeId ?? null,
        projectId: input.projectId ?? null,
        projectMilestoneId: input.projectMilestoneId ?? null,
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
        startDate: input.startDate ?? null,
        dueDate: input.dueDate ?? null,
        position: input.position ?? Number(posRow.pos),
      })
      .returning({ id: issue.id });
    return row.id;
  });

  await recordActivity(issueId, [{ action: 'created' }], actorUserId);
  // Suppress the label_changed event on creation — the initial labels are part of
  // the issue.created payload, so a separate change event would be redundant.
  if (input.labelIds?.length)
    await setIssueLabels(team.id, issueId, input.labelIds, actorUserId, false);
  const created = (await getIssue(issueId))!;
  await emitWebhookEvent(team.id, 'issue.created', created);
  // An issue created already delegated to an agent enqueues a run, the same as
  // delegating one later does.
  await enqueueDelegateRun(created, actorUserId);
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
  return created;
}

export interface IssuePatch {
  stateId?: string;
  position?: number;
  typeId?: string | null;
  projectId?: string | null;
  projectMilestoneId?: string | null;
  assigneeUserId?: string | null;
  delegateUserId?: string | null;
  title?: string;
  description?: string;
  priority?: number;
  estimate?: number | null;
  parentId?: string | null;
  startDate?: string | null;
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
  await assertProject(before.teamId, patch.projectId);
  const projectAfter = patch.projectId !== undefined ? patch.projectId : before.projectId;
  await assertMilestone(projectAfter, patch.projectMilestoneId);
  const stateType = await assertColumn(before.teamId, patch.stateId);
  await assertParent(before.teamId, id, patch.parentId);
  await assertIssueType(before.teamId, patch.typeId);
  return stateType;
}

// Checks a patch against an issue without writing, so a batch can reject the
// whole call before its first update. Throws 404 when the issue does not exist.
export async function validateIssuePatch(id: string, patch: IssuePatch): Promise<void> {
  const before = await loadSnapshot(id);
  if (!before) throw new HttpError(404, 'Issue not found');
  await checkPatch(id, before, patch);
}

export async function updateIssue(
  id: string,
  patch: IssuePatch,
  actorUserId?: string | null,
): Promise<IssueRow | null> {
  const before = await loadSnapshot(id);
  if (!before) return null;

  const stateType = await checkPatch(id, before, patch);

  const set: Partial<typeof issue.$inferInsert> = {};
  if (patch.stateId !== undefined) set.stateId = patch.stateId;
  if (patch.position !== undefined) set.position = patch.position;
  if (patch.typeId !== undefined) set.typeId = patch.typeId;
  if (patch.projectId !== undefined) set.projectId = patch.projectId;
  // Moving the issue to another project (or out of one) clears its milestone,
  // unless the patch sets a milestone of the new project.
  if (patch.projectMilestoneId !== undefined) set.projectMilestoneId = patch.projectMilestoneId;
  else if (patch.projectId !== undefined && patch.projectId !== before.projectId)
    set.projectMilestoneId = null;
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
  if (patch.startDate !== undefined) set.startDate = patch.startDate;
  if (patch.dueDate !== undefined) set.dueDate = patch.dueDate;

  const changed = Object.keys(set).length > 0;
  if (changed) {
    set.updatedAt = sql`now()` as unknown as Date;
    await db.update(issue).set(set).where(eq(issue.id, id));
  }
  const after = await getIssue(id);
  if (after) {
    await logIssueUpdate(before, snapshot(after), actorUserId);
    if (changed) {
      await emitWebhookEvent(after.teamId, 'issue.updated', after);
      // Granular events fire in addition to issue.updated when their field changed.
      if (before.assigneeUserId !== after.assigneeUserId)
        await emitWebhookEvent(after.teamId, 'issue.assigned', after);
      if (before.delegateUserId !== after.delegateUserId)
        await enqueueDelegateRun(after, actorUserId);
      if (before.stateId !== after.stateId)
        await emitWebhookEvent(after.teamId, 'issue.state_changed', after);
    }
  }
  return after;
}

// If an issue's new delegate is an internal agent that reacts to delegation, queue a
// run so it can act on the issue. Skipped when the agent delegated to itself (an
// agent setting itself off). The LLM call happens later in the poller, so the write
// is never blocked on it.
async function enqueueDelegateRun(after: IssueRow, actorUserId?: string | null): Promise<void> {
  const delegate = after.delegateUserId;
  if (!delegate || delegate === actorUserId) return;
  const agent = await getAssignTriggerAgent(delegate);
  if (!agent) return;
  await enqueueAgentRun({
    agentId: agent.id,
    issueId: after.id,
    sourceActivityId: null,
    prompt: `Work item ${after.identifier}: "${after.title}" has been delegated to you. Review it and take the appropriate next step.`,
  });
}

// Deletes an issue and everything attached to it. Field options/values, labels,
// attachments, and activity all go by their ON DELETE CASCADE on issue_id. Returns
// the deleted attachment rows so the caller can remove their objects from the store.
// Returns null if the issue did not exist.
export async function deleteIssue(issueId: string): Promise<AttachmentRow[] | null> {
  const result = await db.transaction(async (tx) => {
    const rows = await tx
      .select({ teamId: issue.teamId, seq: issue.sequenceNumber, key: teamTable.key })
      .from(issue)
      .innerJoin(teamTable, eq(teamTable.id, issue.teamId))
      .where(eq(issue.id, issueId));
    if (rows.length === 0) return null;
    const attachmentRows = await tx
      .select()
      .from(issueAttachment)
      .where(eq(issueAttachment.issueId, issueId));
    await tx.delete(issue).where(eq(issue.id, issueId));
    return {
      attachments: attachmentRows.map(mapAttachment),
      teamId: rows[0].teamId,
      identifier: `${rows[0].key}-${rows[0].seq}`,
    };
  });
  if (!result) return null;
  await emitWebhookEvent(result.teamId, 'issue.deleted', {
    id: issueId,
    identifier: result.identifier,
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
  emitEvent = true,
): Promise<void> {
  await assertIssueLabels(teamId, labelIds);
  const beforeRows = await db
    .select({ labelId: issueLabel.labelId })
    .from(issueLabel)
    .where(eq(issueLabel.issueId, issueId));
  const before = beforeRows.map((r) => r.labelId);
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

  // Labels show on the board card, so a label change must bump the issue's
  // updated_at: the board's change marker (teamBoardRev) is derived from it.
  if (added.length > 0 || removed.length > 0) {
    await db
      .update(issue)
      .set({ updatedAt: sql`now()` })
      .where(eq(issue.id, issueId));
  }

  const names = await labelNames(teamId, [...added, ...removed]);
  const events: ActivityInput[] = [];
  for (const labelId of added)
    events.push({ action: 'label_add', toText: names.get(labelId) ?? null });
  for (const labelId of removed)
    events.push({ action: 'label_remove', fromText: names.get(labelId) ?? null });
  await recordActivity(issueId, events, actorUserId);

  if (emitEvent && (added.length > 0 || removed.length > 0)) {
    const issueRow = await getIssue(issueId);
    if (issueRow) await emitWebhookEvent(issueRow.teamId, 'issue.label_changed', issueRow);
  }
}

// --- Bulk actions ----------------------------------------------------------------
// Board multi-select applies one change to many issues at once. Each of these runs
// the single-issue operation per id in the request, so the per-issue side effects
// (activity feed, webhooks, delegate runs) still fire, but the client makes one
// request and refetches the board once instead of N times.

// The subset of `ids` that belong to this team (active or archived). The bulk
// routes are team-scoped by their guard; filtering here drops any id the client
// sent that is not in this team, so a bulk action can never reach across teams.
async function issuesInTeam(teamId: string, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({ id: issue.id })
    .from(issue)
    .where(and(eq(issue.teamId, teamId), inArray(issue.id, ids)));
  return rows.map((r) => r.id);
}

// Applies the same patch to every listed issue. Returns how many were updated.
export async function bulkUpdateIssues(
  teamId: string,
  ids: string[],
  patch: IssuePatch,
  actorUserId?: string | null,
): Promise<number> {
  const valid = await issuesInTeam(teamId, ids);
  for (const id of valid) await updateIssue(id, patch, actorUserId);
  return valid.length;
}

// Adds the given labels to every listed issue, keeping each issue's existing
// labels. An issue that already carries all of them is left untouched. Returns how
// many issues changed.
export async function bulkAddLabels(
  teamId: string,
  ids: string[],
  labelIds: string[],
  actorUserId?: string | null,
): Promise<number> {
  const add = [...new Set(labelIds)];
  await assertIssueLabels(teamId, add);
  const valid = await issuesInTeam(teamId, ids);
  if (add.length === 0 || valid.length === 0) return 0;

  const rows = await db
    .select({ issueId: issueLabel.issueId, labelId: issueLabel.labelId })
    .from(issueLabel)
    .where(inArray(issueLabel.issueId, valid));
  const current = new Map<string, string[]>();
  for (const r of rows) {
    let list = current.get(r.issueId);
    if (!list) current.set(r.issueId, (list = []));
    list.push(r.labelId);
  }

  let changed = 0;
  for (const id of valid) {
    const have = current.get(id) ?? [];
    const missing = add.filter((l) => !have.includes(l));
    if (missing.length === 0) continue;
    await setIssueLabels(teamId, id, [...have, ...missing], actorUserId);
    changed++;
  }
  return changed;
}

// Archives every listed issue. Returns how many were archived (already-archived
// issues re-stamp to a no-op and still count).
export async function bulkArchiveIssues(
  teamId: string,
  ids: string[],
  actorUserId?: string | null,
): Promise<number> {
  const valid = await issuesInTeam(teamId, ids);
  for (const id of valid) await archiveIssue(id, actorUserId);
  return valid.length;
}

// Deletes every listed issue. Returns the count deleted and their attachment rows
// so the caller can remove the objects from the store.
export async function bulkDeleteIssues(
  teamId: string,
  ids: string[],
): Promise<{ deleted: number; attachments: AttachmentRow[] }> {
  const valid = await issuesInTeam(teamId, ids);
  const attachments: AttachmentRow[] = [];
  for (const id of valid) {
    const rows = await deleteIssue(id);
    if (rows) attachments.push(...rows);
  }
  return { deleted: valid.length, attachments };
}

// --- Change markers (cheap watermarks for live refresh) --------------------------
// Opaque strings that change whenever the corresponding view's data changes.
// Clients poll these cheaply and refetch the heavy payload only when the marker
// moved, so a live board / open issue stays current without constant full reads.

// The board's marker: changes when any issue or project in the team is
// created, updated, or deleted. Issue label changes bump updated_at too (see
// setIssueLabels). Project metadata is part of the work-items board payload.
export async function teamBoardRev(teamId: string): Promise<string> {
  const [row] = await db
    .select({
      n: sql<number>`count(*)`,
      m: sql<string | null>`max(${issue.updatedAt})::text`,
      projectCount: sql<number>`(select count(*) from ${projectTeam} where ${projectTeam.teamId} = ${teamId})`,
      projectMax: sql<
        string | null
      >`(select max(${project.updatedAt})::text from ${project} where ${project.id} in (select ${projectTeam.projectId} from ${projectTeam} where ${projectTeam.teamId} = ${teamId}))`,
    })
    // Only active issues count: archiving one (manual or the worker's sweep) drops
    // the count, which moves the marker and makes the board refetch it away.
    .from(issue)
    .where(and(eq(issue.teamId, teamId), isNull(issue.archivedAt)));
  return `${row?.n ?? 0}:${row?.m ?? ''}:${row?.projectCount ?? 0}:${row?.projectMax ?? ''}`;
}

// One issue's marker: changes on any edit or new timeline entry (comment or
// activity), including an agent's reply. The activity count and newest created_at
// cover the feed and every logged edit; updated_at covers in-place field edits.
export async function issueRev(issueId: string): Promise<string> {
  const [row] = await db
    .select({
      a: sql<string>`(select count(*) || '-' || coalesce(max(created_at)::text, '') from issue_activity where issue_id = ${issueId})`,
      u: sql<string>`${issue.updatedAt}::text`,
    })
    .from(issue)
    .where(eq(issue.id, issueId));
  return row ? `${row.a ?? 0}:${row.u}` : '0:';
}

// --- Custom field values on an issue ---------------------------------------------

export interface IssueFieldValueRow {
  fieldId: string;
  name: string;
  fieldType: CustomFieldType;
  value: string | number | boolean | null;
  optionIds: string[];
}

function pickScalarValue(row: {
  valueText: string | null;
  valueNumber: string | null;
  valueBool: boolean | null;
  valueDate: string | null;
}): string | number | boolean | null {
  if (row.valueText != null) return row.valueText;
  if (row.valueNumber != null) return Number(row.valueNumber);
  if (row.valueBool != null) return row.valueBool;
  if (row.valueDate != null) return row.valueDate;
  return null;
}

// The fields of the issue's team that apply to it (the team-wide ones plus
// its type's own), each joined with whatever value has been set for it (null if
// unset).
export async function getIssueFieldValues(issueId: string): Promise<IssueFieldValueRow[]> {
  const rows = await db
    .select({
      fieldId: customField.id,
      name: customField.name,
      fieldType: customField.fieldType,
      valueText: issueFieldValue.valueText,
      valueNumber: issueFieldValue.valueNumber,
      valueBool: issueFieldValue.valueBool,
      valueDate: issueFieldValue.valueDate,
    })
    .from(issue)
    .innerJoin(
      customField,
      and(
        eq(customField.teamId, issue.teamId),
        or(isNull(customField.issueTypeId), eq(customField.issueTypeId, issue.typeId)),
      ),
    )
    .leftJoin(
      issueFieldValue,
      and(eq(issueFieldValue.fieldId, customField.id), eq(issueFieldValue.issueId, issue.id)),
    )
    .where(eq(issue.id, issueId))
    .orderBy(customField.position);

  const optionRows = await db
    .select({ fieldId: issueFieldOption.fieldId, optionId: issueFieldOption.optionId })
    .from(issueFieldOption)
    .where(eq(issueFieldOption.issueId, issueId));
  const optionsByField = new Map<string, string[]>();
  for (const r of optionRows) {
    let list = optionsByField.get(r.fieldId);
    if (!list) optionsByField.set(r.fieldId, (list = []));
    list.push(r.optionId);
  }

  return rows.map((row) => ({
    fieldId: row.fieldId,
    name: row.name,
    fieldType: row.fieldType as CustomFieldType,
    value: pickScalarValue(row),
    optionIds: optionsByField.get(row.fieldId) ?? [],
  }));
}

// A value is an acceptable url field value when it parses as an absolute
// http(s) URL. Other schemes (mailto:, javascript:, file:) are rejected.
function isHttpUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === 'http:' || url.protocol === 'https:';
}

// Sets one field's value on one issue. teamId is the issue's team: the field
// is resolved inside it, so a field id belonging to another team does not match.
// For select/multi_select fields, pass optionIds (replaces the full selection); for
// every other field type, pass value matching the field's type.
export async function setIssueFieldValue(
  teamId: string,
  issueId: string,
  fieldId: string,
  input: { value?: string | number | boolean | null; optionIds?: string[] },
  actorUserId?: string | null,
): Promise<void> {
  const field = await getCustomFieldById(teamId, fieldId);
  if (!field) throw new HttpError(404, 'Custom field not found');

  // A url field stores its value as text but must hold a valid http(s) URL.
  if (field.fieldType === 'url' && typeof input.value === 'string' && input.value !== '') {
    if (!isHttpUrl(input.value)) throw new HttpError(400, 'Invalid URL');
  }
  // A number field must be a finite number; the value column is numeric.
  if (field.fieldType === 'number' && input.value != null && input.value !== '') {
    if (!Number.isFinite(Number(input.value))) throw new HttpError(400, 'Invalid number');
  }

  // to_text is the display-ready new value logged to the activity feed: option
  // value names for select/multi_select, the raw value for everything else.
  let toText: string | null;

  if (field.fieldType === 'select' || field.fieldType === 'multi_select') {
    const optionIds = input.optionIds ?? [];
    // An option must be one of this field's own: the issue_field_option foreign key
    // only requires it to exist somewhere. Resolved before the delete so a rejected
    // request leaves the current selection untouched.
    const names = optionIds.map((optionId) => {
      const option = field.options.find((o) => o.id === optionId);
      if (!option) throw new HttpError(400, 'Option does not belong to this field');
      return option.value;
    });

    await db
      .delete(issueFieldOption)
      .where(and(eq(issueFieldOption.issueId, issueId), eq(issueFieldOption.fieldId, fieldId)));
    if (optionIds.length) {
      await db
        .insert(issueFieldOption)
        .values(optionIds.map((optionId) => ({ issueId, fieldId, optionId })));
    }
    toText = names.length ? names.join(', ') : null;
  } else {
    // The value column matching the field's type; the others stay NULL. Both the
    // insert and the on-conflict update write only that one column.
    let column: Partial<typeof issueFieldValue.$inferInsert>;
    switch (field.fieldType) {
      case 'number':
        column = { valueNumber: input.value == null ? null : String(input.value) };
        break;
      case 'boolean':
        column = { valueBool: input.value == null ? null : Boolean(input.value) };
        break;
      case 'date':
        column = { valueDate: (input.value as string) ?? null };
        break;
      default:
        column = { valueText: (input.value as string) ?? null };
    }
    await db
      .insert(issueFieldValue)
      .values({ issueId, fieldId, ...column })
      .onConflictDoUpdate({
        target: [issueFieldValue.issueId, issueFieldValue.fieldId],
        set: column,
      });
    const value = input.value;
    if (value == null || value === '') {
      toText = null;
    } else if (field.fieldType === 'boolean') {
      toText = value ? 'true' : 'false';
    } else {
      toText = String(value);
    }
  }

  await recordActivity(issueId, [{ action: 'field', subject: field.name, toText }], actorUserId);
}
