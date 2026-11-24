import { db, workflowDefinition } from '@repo/db';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { HttpError, iso, num, UUID_RE } from '../shared/lib';
import { assertMayCreate, assertMayEdit, assertMayManageAccess, assertSeesTeam } from './access';
import { MAX_RULES_PER_TEAM, validateRule, type RuleFields, type RuleInput } from './validate';

// Team automation rules (Linear's WorkflowDefinition): their storage and management.
// The instance plugin handlers (instance/handlers.ts) call these with the signed-in
// user; the run engine reads enabled rules with listEnabledRules.

export interface WorkflowStats {
  runs: number;
  lastError?: string;
}

export interface WorkflowRow extends RuleFields {
  id: string;
  slugId: string;
  creatorId: string | null;
  lastUpdatedById: string | null;
  lastExecutedAt: string | null;
  stats: WorkflowStats;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

type Row = typeof workflowDefinition.$inferSelect;

// The order rules are listed and run in: sortOrder, then creation, then id.
export const RULE_ORDER = [
  asc(workflowDefinition.sortOrder),
  asc(workflowDefinition.createdAt),
  asc(workflowDefinition.id),
] as const;

export function mapWorkflow(row: Row): WorkflowRow {
  return {
    id: row.id,
    slugId: row.slugId,
    teamId: row.teamId,
    name: row.name,
    description: row.description,
    icon: row.icon,
    color: row.color,
    type: row.type as 'automation',
    triggerType: row.triggerType as 'issue',
    trigger: row.trigger as RuleFields['trigger'],
    activationMode: row.activationMode as RuleFields['activationMode'],
    conditions: row.conditions as Record<string, unknown>,
    activities: row.activities as RuleFields['activities'],
    enabled: row.enabled,
    sortOrder: num(row.sortOrder),
    editAccess: row.editAccess as RuleFields['editAccess'],
    ownerId: row.ownerUserId,
    creatorId: row.creatorUserId,
    lastUpdatedById: row.updatedByUserId,
    lastExecutedAt: row.lastExecutedAt ? iso(row.lastExecutedAt) : null,
    stats: row.stats as WorkflowStats,
    archivedAt: row.archivedAt ? iso(row.archivedAt) : null,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

function toColumns(fields: RuleFields) {
  return {
    teamId: fields.teamId,
    name: fields.name,
    description: fields.description,
    icon: fields.icon,
    color: fields.color,
    type: fields.type,
    triggerType: fields.triggerType,
    trigger: fields.trigger,
    activationMode: fields.activationMode,
    conditions: fields.conditions,
    activities: fields.activities,
    enabled: fields.enabled,
    sortOrder: fields.sortOrder,
    editAccess: fields.editAccess,
    ownerUserId: fields.ownerId,
  };
}

async function findRow(id: unknown): Promise<Row | undefined> {
  if (typeof id !== 'string' || !UUID_RE.test(id)) return undefined;
  const [row] = await db
    .select()
    .from(workflowDefinition)
    .where(and(eq(workflowDefinition.id, id), isNull(workflowDefinition.deletedAt)));
  return row;
}

// A rule the user can see (through its team); 404 otherwise.
async function visibleRule(id: unknown, userId: string): Promise<WorkflowRow> {
  const row = await findRow(id);
  if (!row) throw new HttpError(404, 'Workflow not found');
  await assertSeesTeam(row.teamId, userId, 'Workflow not found');
  return mapWorkflow(row);
}

export async function listWorkflows(
  teamId: unknown,
  userId: string,
  includeArchived = false,
): Promise<WorkflowRow[]> {
  if (typeof teamId !== 'string' || !UUID_RE.test(teamId))
    throw new HttpError(400, 'teamId must be a team id');
  await assertSeesTeam(teamId, userId);
  const rows = await db
    .select()
    .from(workflowDefinition)
    .where(
      and(
        eq(workflowDefinition.teamId, teamId),
        isNull(workflowDefinition.deletedAt),
        includeArchived ? undefined : isNull(workflowDefinition.archivedAt),
      ),
    )
    .orderBy(...RULE_ORDER);
  return rows.map(mapWorkflow);
}

export function getWorkflow(id: unknown, userId: string): Promise<WorkflowRow> {
  return visibleRule(id, userId);
}

export async function createWorkflow(input: RuleInput, userId: string): Promise<WorkflowRow> {
  const teamId = input.teamId;
  if (typeof teamId !== 'string' || !UUID_RE.test(teamId))
    throw new HttpError(400, 'teamId must be a team id');
  await assertSeesTeam(teamId, userId);
  await assertMayCreate(teamId, userId);
  const [last] = await db
    .select({
      max: sql<number | null>`max(${workflowDefinition.sortOrder})`,
      count: sql<number>`count(*)::int`,
    })
    .from(workflowDefinition)
    .where(and(eq(workflowDefinition.teamId, teamId), isNull(workflowDefinition.deletedAt)));
  if (num(last?.count) >= MAX_RULES_PER_TEAM)
    throw new HttpError(400, `A team has at most ${MAX_RULES_PER_TEAM} workflows`);
  const fields = await validateRule(input, null, userId, num(last?.max) + 1000);
  const [row] = await db
    .insert(workflowDefinition)
    .values({ ...toColumns(fields), creatorUserId: userId, updatedByUserId: userId })
    .returning();
  return mapWorkflow(row!);
}

// Changes a rule. Who may edit follows its edit access; changing the edit access
// needs a team manager. Changing the conditions or actions makes the editor the owner
// (validateRule).
export async function updateWorkflow(
  id: unknown,
  patch: RuleInput,
  userId: string,
): Promise<WorkflowRow> {
  const existing = await visibleRule(id, userId);
  await assertMayEdit(existing, userId);
  if (patch.teamId !== undefined && patch.teamId !== existing.teamId)
    throw new HttpError(400, 'A workflow cannot move to another team');
  if (patch.editAccess !== undefined && patch.editAccess !== existing.editAccess)
    await assertMayManageAccess(existing.teamId, userId);
  const fields = await validateRule(patch, existing, userId, existing.sortOrder);
  return write(existing.id, { ...toColumns(fields), updatedByUserId: userId });
}

async function write(
  id: string,
  values: Partial<typeof workflowDefinition.$inferInsert>,
): Promise<WorkflowRow> {
  const [row] = await db
    .update(workflowDefinition)
    .set({ ...values, updatedAt: new Date() })
    .where(and(eq(workflowDefinition.id, id), isNull(workflowDefinition.deletedAt)))
    .returning();
  if (!row) throw new HttpError(404, 'Workflow not found');
  return mapWorkflow(row);
}

async function editable(id: unknown, userId: string): Promise<WorkflowRow> {
  const existing = await visibleRule(id, userId);
  await assertMayEdit(existing, userId);
  return existing;
}

export async function setWorkflowEnabled(
  id: unknown,
  enabled: unknown,
  userId: string,
): Promise<WorkflowRow> {
  if (typeof enabled !== 'boolean') throw new HttpError(400, 'enabled must be true or false');
  const existing = await editable(id, userId);
  return write(existing.id, { enabled, updatedByUserId: userId });
}

export async function reorderWorkflow(
  id: unknown,
  sortOrder: unknown,
  userId: string,
): Promise<WorkflowRow> {
  if (typeof sortOrder !== 'number' || !Number.isFinite(sortOrder))
    throw new HttpError(400, 'sortOrder must be a number');
  const existing = await editable(id, userId);
  return write(existing.id, { sortOrder, updatedByUserId: userId });
}

export async function archiveWorkflow(
  id: unknown,
  archived: boolean,
  userId: string,
): Promise<WorkflowRow> {
  const existing = await editable(id, userId);
  return write(existing.id, { archivedAt: archived ? new Date() : null, updatedByUserId: userId });
}

// Deleting keeps the row (deletedAt) so the history entries, comments and notifications
// the rule made still name it (graphql/resolvers/workflow-definition.ts); every other
// read leaves it out.
export async function deleteWorkflow(id: unknown, userId: string): Promise<void> {
  const existing = await editable(id, userId);
  await write(existing.id, { deletedAt: new Date(), enabled: false, updatedByUserId: userId });
}
