import { db, workflowState, issue, issueLabel, issueFieldValue, issueFieldOption } from '@repo/db';
import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { HttpError, iso } from '../shared/lib';
import { recordActivityForIssues } from '../issues/activity';

// Data access for columns (kanban states). A column belongs to one team and
// has a state type that fixes its place in the work items view's left-to-right order.

export interface WorkflowStateRow {
  id: string;
  teamId: string;
  name: string;
  stateType: string;
  color: string;
  description: string;
  position: number;
  // When the column was archived, or null while it is active. Archived columns are
  // hidden from the board and cannot hold issues.
  archivedAt: string | null;
}

function mapColumn(row: typeof workflowState.$inferSelect): WorkflowStateRow {
  return {
    id: row.id,
    teamId: row.teamId,
    name: row.name,
    stateType: row.stateType,
    color: row.color,
    description: row.description,
    position: row.position,
    archivedAt: row.archivedAt ? iso(row.archivedAt) : null,
  };
}

// Columns are ordered by state type (backlog → unstarted → started → completed
// → canceled), then by position within a type. This is the work items view's left-to-right
// order, so a newly added column appears next to the others of its state type
// rather than at the end.
const STATE_TYPE_ORDER = sql`CASE ${workflowState.stateType}
    WHEN 'backlog' THEN 0
    WHEN 'unstarted' THEN 1
    WHEN 'started' THEN 2
    WHEN 'completed' THEN 3
    WHEN 'canceled' THEN 4
    ELSE 5
  END`;

// Active columns only, unless includeArchived is set.
export async function listStates(
  teamId: string,
  opts: { includeArchived?: boolean } = {},
): Promise<WorkflowStateRow[]> {
  const rows = await db
    .select()
    .from(workflowState)
    .where(
      and(
        eq(workflowState.teamId, teamId),
        opts.includeArchived ? undefined : isNull(workflowState.archivedAt),
      ),
    )
    .orderBy(STATE_TYPE_ORDER, workflowState.position);
  return rows.map(mapColumn);
}

export async function createState(input: {
  teamId: string;
  name: string;
  stateType: string;
  color?: string;
  description?: string;
}): Promise<WorkflowStateRow> {
  const [{ pos }] = await db
    .select({ pos: sql<number>`COALESCE(MAX(${workflowState.position}), -1) + 1` })
    .from(workflowState)
    .where(eq(workflowState.teamId, input.teamId));
  const [row] = await db
    .insert(workflowState)
    .values({
      teamId: input.teamId,
      name: input.name,
      stateType: input.stateType,
      color: input.color ?? '#6b7280',
      description: input.description ?? '',
      position: Number(pos),
    })
    .returning();
  return mapColumn(row);
}

export async function getStateById(id: string): Promise<WorkflowStateRow | null> {
  const rows = await db.select().from(workflowState).where(eq(workflowState.id, id));
  return rows[0] ? mapColumn(rows[0]) : null;
}

// Scoped to teamId so a column id from another team resolves to null (the
// route turns that into a 404), never a cross-team edit.
export async function updateState(
  id: string,
  teamId: string,
  patch: { name?: string; color?: string; stateType?: string; description?: string },
): Promise<WorkflowStateRow | null> {
  const scope = and(eq(workflowState.id, id), eq(workflowState.teamId, teamId));
  const set: Partial<typeof workflowState.$inferInsert> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.color !== undefined) set.color = patch.color;
  if (patch.stateType !== undefined) set.stateType = patch.stateType;
  if (patch.description !== undefined) set.description = patch.description;
  if (Object.keys(set).length === 0) {
    const rows = await db.select().from(workflowState).where(scope);
    return rows[0] ? mapColumn(rows[0]) : null;
  }
  const [row] = await db.update(workflowState).set(set).where(scope).returning();
  return row ? mapColumn(row) : null;
}

// Archives a column (Linear's workflowStateArchive). Refused with 409 while any
// active issue is in it, and for the last active column of its type, so every
// team keeps one column per type. Scoped to teamId; another team's column
// is a 404. Archiving an archived column returns it unchanged.
export async function archiveState(id: string, teamId: string): Promise<WorkflowStateRow> {
  const column = await getStateById(id);
  if (!column || column.teamId !== teamId) throw new HttpError(404, 'Column not found');
  if (column.archivedAt) return column;
  const [{ issues }] = await db
    .select({ issues: sql<number>`count(*)::int` })
    .from(issue)
    .where(and(eq(issue.stateId, id), isNull(issue.archivedAt)));
  if (issues > 0)
    throw new HttpError(409, 'Move the issues out of this column before archiving it');
  const [{ others }] = await db
    .select({ others: sql<number>`count(*)::int` })
    .from(workflowState)
    .where(
      and(
        eq(workflowState.teamId, teamId),
        eq(workflowState.stateType, column.stateType),
        isNull(workflowState.archivedAt),
        ne(workflowState.id, id),
      ),
    );
  if (others === 0)
    throw new HttpError(409, `The last ${column.stateType} column cannot be archived`);
  const [row] = await db
    .update(workflowState)
    .set({ archivedAt: sql`now()` })
    .where(eq(workflowState.id, id))
    .returning();
  return mapColumn(row);
}

// Renumbers the team's active columns to match orderedIds (the desired left-to-right
// order). Any column not listed is appended in its current order. Runs a two-pass
// update — first shift every position out of range, then assign 0..n-1 — so the
// unique (team_id, position) index over active columns never sees a transient
// duplicate.
export async function reorderStates(teamId: string, orderedIds: string[]): Promise<void> {
  const existing = await listStates(teamId);
  const known = new Set(existing.map((c) => c.id));
  const finalOrder = orderedIds.filter((id) => known.has(id));
  for (const c of existing) if (!finalOrder.includes(c.id)) finalOrder.push(c.id);

  await db.transaction(async (tx) => {
    await tx
      .update(workflowState)
      .set({ position: sql`${workflowState.position} + 1000000` })
      .where(and(eq(workflowState.teamId, teamId), isNull(workflowState.archivedAt)));
    for (const [index, id] of finalOrder.entries()) {
      await tx
        .update(workflowState)
        .set({ position: index })
        .where(and(eq(workflowState.id, id), eq(workflowState.teamId, teamId)));
    }
  });
}

// Deletes a column. `move` reassigns the column's issues to targetStateId before
// dropping the column; `delete` removes the issues and their dependent rows
// (labels, custom field values/options) first. Backlog columns cannot be deleted,
// which keeps at least one column on every team. Runs in one transaction so the
// column and its issues are never left half-deleted.
export type DeleteStateOptions = { mode: 'move'; targetStateId: string } | { mode: 'delete' };

export async function deleteState(
  stateId: string,
  teamId: string,
  opts: DeleteStateOptions,
  actorUserId?: string | null,
): Promise<void> {
  const column = await getStateById(stateId);
  // Scoped to teamId: a column id outside the caller's team is a 404, not a
  // cross-team delete.
  if (!column || column.teamId !== teamId) throw new HttpError(404, `Column ${stateId} not found`);
  if (column.stateType === 'backlog') throw new HttpError(400, 'Backlog columns cannot be deleted');

  let target: WorkflowStateRow | null = null;
  if (opts.mode === 'move') {
    target = await getStateById(opts.targetStateId);
    if (!target || target.teamId !== column.teamId)
      throw new HttpError(400, 'Target column must belong to the same team');
    if (target.id === column.id)
      throw new HttpError(400, 'Target column must differ from the deleted column');
  }

  const movedIssueIds = await db.transaction(async (tx) => {
    let moved: string[] = [];
    if (opts.mode === 'move') {
      const rows = await tx
        .update(issue)
        .set({ stateId: opts.targetStateId, updatedAt: sql`now()` })
        .where(eq(issue.stateId, stateId))
        .returning({ id: issue.id });
      moved = rows.map((r) => r.id);
    } else {
      const issueIds = tx.select({ id: issue.id }).from(issue).where(eq(issue.stateId, stateId));
      await tx.delete(issueFieldOption).where(inArray(issueFieldOption.issueId, issueIds));
      await tx.delete(issueFieldValue).where(inArray(issueFieldValue.issueId, issueIds));
      await tx.delete(issueLabel).where(inArray(issueLabel.issueId, issueIds));
      await tx.delete(issue).where(eq(issue.stateId, stateId));
    }
    await tx.delete(workflowState).where(eq(workflowState.id, stateId));
    return moved;
  });

  // A reassignment is a status change like any other, so it belongs in the change
  // log: the issue's status timeline reads its stretches from these entries, and
  // without one the issue keeps counting time under the column it no longer sits in.
  if (target)
    await recordActivityForIssues(
      movedIssueIds,
      { action: 'status', fromText: column.name, toText: target.name },
      actorUserId,
    );
}
