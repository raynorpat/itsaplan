import { db, issueType } from '@repo/db';
import { and, eq, sql } from 'drizzle-orm';

// Data access for issue types. An issue type belongs to one team. Deleting a
// type sets type_id NULL on its issues and cascades to its type-scoped custom
// fields (and those fields' options and values), all via the schema's ON DELETE
// clauses.

export interface IssueTypeRow {
  id: string;
  teamId: string;
  name: string;
  icon: string;
  color: string;
  isDefault: boolean;
  position: number;
}

function mapIssueType(row: typeof issueType.$inferSelect): IssueTypeRow {
  return {
    id: row.id,
    teamId: row.teamId,
    name: row.name,
    icon: row.icon,
    color: row.color,
    isDefault: row.isDefault,
    position: row.position,
  };
}

export async function listIssueTypes(teamId: string): Promise<IssueTypeRow[]> {
  const rows = await db
    .select()
    .from(issueType)
    .where(eq(issueType.teamId, teamId))
    .orderBy(issueType.position);
  return rows.map(mapIssueType);
}

export async function createIssueType(input: {
  teamId: string;
  name: string;
  icon?: string;
  color?: string;
  isDefault?: boolean;
}): Promise<IssueTypeRow> {
  const [{ pos }] = await db
    .select({ pos: sql<number>`COALESCE(MAX(${issueType.position}), -1) + 1` })
    .from(issueType)
    .where(eq(issueType.teamId, input.teamId));
  const [row] = await db
    .insert(issueType)
    .values({
      teamId: input.teamId,
      name: input.name,
      icon: input.icon ?? '',
      color: input.color ?? '#6b7280',
      isDefault: input.isDefault ?? false,
      position: Number(pos),
    })
    .returning();
  return mapIssueType(row);
}

export async function getIssueTypeById(id: string): Promise<IssueTypeRow | null> {
  const rows = await db.select().from(issueType).where(eq(issueType.id, id));
  return rows[0] ? mapIssueType(rows[0]) : null;
}

// Scoped to teamId so an id from another team resolves to null (a 404 at
// the route), never a cross-team edit.
export async function updateIssueType(
  id: string,
  teamId: string,
  patch: { name?: string; color?: string; isDefault?: boolean },
): Promise<IssueTypeRow | null> {
  const scope = and(eq(issueType.id, id), eq(issueType.teamId, teamId));
  const set: Partial<typeof issueType.$inferInsert> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.color !== undefined) set.color = patch.color;
  if (patch.isDefault !== undefined) set.isDefault = patch.isDefault;
  if (Object.keys(set).length === 0) {
    const rows = await db.select().from(issueType).where(scope);
    return rows[0] ? mapIssueType(rows[0]) : null;
  }
  const [row] = await db.update(issueType).set(set).where(scope).returning();
  return row ? mapIssueType(row) : null;
}

// Scoped to teamId: an id outside the team deletes nothing.
export async function deleteIssueType(id: string, teamId: string): Promise<void> {
  await db.delete(issueType).where(and(eq(issueType.id, id), eq(issueType.teamId, teamId)));
}
