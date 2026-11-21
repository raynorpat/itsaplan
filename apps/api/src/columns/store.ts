import { db, projectColumn, issue, issueLabel, issueFieldValue, issueFieldOption } from '@repo/db';
import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { HttpError, iso } from '../shared/lib';
import { recordActivityForIssues } from '../issues/activity';

// Data access for columns (kanban states). A column belongs to one project and
// has a state type that fixes its place in the work items view's left-to-right order.

export interface ColumnRow {
  id: string;
  projectId: string;
  name: string;
  stateType: string;
  color: string;
  description: string;
  position: number;
  // When the column was archived, or null while it is active. Archived columns are
  // hidden from the board and cannot hold issues.
  archivedAt: string | null;
}

function mapColumn(row: typeof projectColumn.$inferSelect): ColumnRow {
  return {
    id: row.id,
    projectId: row.projectId,
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
const STATE_TYPE_ORDER = sql`CASE ${projectColumn.stateType}
    WHEN 'backlog' THEN 0
    WHEN 'unstarted' THEN 1
    WHEN 'started' THEN 2
    WHEN 'completed' THEN 3
    WHEN 'canceled' THEN 4
    ELSE 5
  END`;

// Active columns only, unless includeArchived is set.
export async function listColumns(
  projectId: string,
  opts: { includeArchived?: boolean } = {},
): Promise<ColumnRow[]> {
  const rows = await db
    .select()
    .from(projectColumn)
    .where(
      and(
        eq(projectColumn.projectId, projectId),
        opts.includeArchived ? undefined : isNull(projectColumn.archivedAt),
      ),
    )
    .orderBy(STATE_TYPE_ORDER, projectColumn.position);
  return rows.map(mapColumn);
}

export async function createColumn(input: {
  projectId: string;
  name: string;
  stateType: string;
  color?: string;
  description?: string;
}): Promise<ColumnRow> {
  const [{ pos }] = await db
    .select({ pos: sql<number>`COALESCE(MAX(${projectColumn.position}), -1) + 1` })
    .from(projectColumn)
    .where(eq(projectColumn.projectId, input.projectId));
  const [row] = await db
    .insert(projectColumn)
    .values({
      projectId: input.projectId,
      name: input.name,
      stateType: input.stateType,
      color: input.color ?? '#6b7280',
      description: input.description ?? '',
      position: Number(pos),
    })
    .returning();
  return mapColumn(row);
}

export async function getColumnById(id: string): Promise<ColumnRow | null> {
  const rows = await db.select().from(projectColumn).where(eq(projectColumn.id, id));
  return rows[0] ? mapColumn(rows[0]) : null;
}

// Scoped to projectId so a column id from another project resolves to null (the
// route turns that into a 404), never a cross-project edit.
export async function updateColumn(
  id: string,
  projectId: string,
  patch: { name?: string; color?: string; stateType?: string; description?: string },
): Promise<ColumnRow | null> {
  const scope = and(eq(projectColumn.id, id), eq(projectColumn.projectId, projectId));
  const set: Partial<typeof projectColumn.$inferInsert> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.color !== undefined) set.color = patch.color;
  if (patch.stateType !== undefined) set.stateType = patch.stateType;
  if (patch.description !== undefined) set.description = patch.description;
  if (Object.keys(set).length === 0) {
    const rows = await db.select().from(projectColumn).where(scope);
    return rows[0] ? mapColumn(rows[0]) : null;
  }
  const [row] = await db.update(projectColumn).set(set).where(scope).returning();
  return row ? mapColumn(row) : null;
}

// Archives a column (Linear's workflowStateArchive). Refused with 409 while any
// active issue is in it, and for the last active column of its type, so every
// project keeps one column per type. Scoped to projectId; another project's column
// is a 404. Archiving an archived column returns it unchanged.
export async function archiveColumn(id: string, projectId: string): Promise<ColumnRow> {
  const column = await getColumnById(id);
  if (!column || column.projectId !== projectId) throw new HttpError(404, 'Column not found');
  if (column.archivedAt) return column;
  const [{ issues }] = await db
    .select({ issues: sql<number>`count(*)::int` })
    .from(issue)
    .where(and(eq(issue.columnId, id), isNull(issue.archivedAt)));
  if (issues > 0)
    throw new HttpError(409, 'Move the issues out of this column before archiving it');
  const [{ others }] = await db
    .select({ others: sql<number>`count(*)::int` })
    .from(projectColumn)
    .where(
      and(
        eq(projectColumn.projectId, projectId),
        eq(projectColumn.stateType, column.stateType),
        isNull(projectColumn.archivedAt),
        ne(projectColumn.id, id),
      ),
    );
  if (others === 0)
    throw new HttpError(409, `The last ${column.stateType} column cannot be archived`);
  const [row] = await db
    .update(projectColumn)
    .set({ archivedAt: sql`now()` })
    .where(eq(projectColumn.id, id))
    .returning();
  return mapColumn(row);
}

// Renumbers the project's active columns to match orderedIds (the desired left-to-right
// order). Any column not listed is appended in its current order. Runs a two-pass
// update — first shift every position out of range, then assign 0..n-1 — so the
// unique (project_id, position) index over active columns never sees a transient
// duplicate.
export async function reorderColumns(projectId: string, orderedIds: string[]): Promise<void> {
  const existing = await listColumns(projectId);
  const known = new Set(existing.map((c) => c.id));
  const finalOrder = orderedIds.filter((id) => known.has(id));
  for (const c of existing) if (!finalOrder.includes(c.id)) finalOrder.push(c.id);

  await db.transaction(async (tx) => {
    await tx
      .update(projectColumn)
      .set({ position: sql`${projectColumn.position} + 1000000` })
      .where(and(eq(projectColumn.projectId, projectId), isNull(projectColumn.archivedAt)));
    for (const [index, id] of finalOrder.entries()) {
      await tx
        .update(projectColumn)
        .set({ position: index })
        .where(and(eq(projectColumn.id, id), eq(projectColumn.projectId, projectId)));
    }
  });
}

// Deletes a column. `move` reassigns the column's issues to targetColumnId before
// dropping the column; `delete` removes the issues and their dependent rows
// (labels, custom field values/options) first. Backlog columns cannot be deleted,
// which keeps at least one column on every project. Runs in one transaction so the
// column and its issues are never left half-deleted.
export type DeleteColumnOptions = { mode: 'move'; targetColumnId: string } | { mode: 'delete' };

export async function deleteColumn(
  columnId: string,
  projectId: string,
  opts: DeleteColumnOptions,
  actorUserId?: string | null,
): Promise<void> {
  const column = await getColumnById(columnId);
  // Scoped to projectId: a column id outside the caller's project is a 404, not a
  // cross-project delete.
  if (!column || column.projectId !== projectId)
    throw new HttpError(404, `Column ${columnId} not found`);
  if (column.stateType === 'backlog') throw new HttpError(400, 'Backlog columns cannot be deleted');

  let target: ColumnRow | null = null;
  if (opts.mode === 'move') {
    target = await getColumnById(opts.targetColumnId);
    if (!target || target.projectId !== column.projectId)
      throw new HttpError(400, 'Target column must belong to the same project');
    if (target.id === column.id)
      throw new HttpError(400, 'Target column must differ from the deleted column');
  }

  const movedIssueIds = await db.transaction(async (tx) => {
    let moved: string[] = [];
    if (opts.mode === 'move') {
      const rows = await tx
        .update(issue)
        .set({ columnId: opts.targetColumnId, updatedAt: sql`now()` })
        .where(eq(issue.columnId, columnId))
        .returning({ id: issue.id });
      moved = rows.map((r) => r.id);
    } else {
      const issueIds = tx.select({ id: issue.id }).from(issue).where(eq(issue.columnId, columnId));
      await tx.delete(issueFieldOption).where(inArray(issueFieldOption.issueId, issueIds));
      await tx.delete(issueFieldValue).where(inArray(issueFieldValue.issueId, issueIds));
      await tx.delete(issueLabel).where(inArray(issueLabel.issueId, issueIds));
      await tx.delete(issue).where(eq(issue.columnId, columnId));
    }
    await tx.delete(projectColumn).where(eq(projectColumn.id, columnId));
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
