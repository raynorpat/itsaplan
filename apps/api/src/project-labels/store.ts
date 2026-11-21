import { db, projectLabel, teamMember } from '@repo/db';
import { asc, eq } from 'drizzle-orm';
import { HttpError, iso, rethrowDuplicate } from '../shared/lib';

// Workspace-level project labels (Linear's ProjectLabel), separate from the
// per-team issue labels. A group (isGroup) holds child labels and cannot be
// applied to a project; groups do not nest.

export interface ProjectLabelRow {
  id: string;
  name: string;
  color: string;
  description: string | null;
  parentId: string | null;
  isGroup: boolean;
  createdAt: string;
  updatedAt: string;
}

function mapLabel(row: typeof projectLabel.$inferSelect): ProjectLabelRow {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    description: row.description,
    parentId: row.parentId,
    isGroup: row.isGroup,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export async function listProjectLabels(): Promise<ProjectLabelRow[]> {
  const rows = await db.select().from(projectLabel).orderBy(asc(projectLabel.name));
  return rows.map(mapLabel);
}

export async function getProjectLabel(id: string): Promise<ProjectLabelRow | null> {
  const [row] = await db.select().from(projectLabel).where(eq(projectLabel.id, id));
  return row ? mapLabel(row) : null;
}

// A parent must be an existing group; a group cannot have a parent.
async function assertParent(parentId: string | null | undefined, isGroup: boolean): Promise<void> {
  if (!parentId) return;
  if (isGroup) throw new HttpError(400, 'A label group cannot be nested in another group');
  const parent = await getProjectLabel(parentId);
  if (!parent?.isGroup) throw new HttpError(400, 'parentId must be a label group');
}

export interface NewProjectLabelInput {
  name: string;
  color?: string;
  description?: string | null;
  parentId?: string | null;
  isGroup?: boolean;
}

export async function createProjectLabel(input: NewProjectLabelInput): Promise<ProjectLabelRow> {
  await assertParent(input.parentId, input.isGroup ?? false);
  try {
    const [row] = await db
      .insert(projectLabel)
      .values({
        name: input.name,
        color: input.color ?? '#4EA7FC',
        description: input.description ?? null,
        parentId: input.parentId ?? null,
        isGroup: input.isGroup ?? false,
      })
      .returning();
    return mapLabel(row!);
  } catch (err) {
    rethrowDuplicate(err, 'project label');
  }
}

export interface ProjectLabelPatch {
  name?: string;
  color?: string;
  description?: string | null;
  parentId?: string | null;
}

// Returns null when the label does not exist.
export async function updateProjectLabel(
  id: string,
  patch: ProjectLabelPatch,
): Promise<ProjectLabelRow | null> {
  const before = await getProjectLabel(id);
  if (!before) return null;
  if (patch.parentId !== undefined) await assertParent(patch.parentId, before.isGroup);
  try {
    const [row] = await db
      .update(projectLabel)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(projectLabel.id, id))
      .returning();
    return row ? mapLabel(row) : null;
  } catch (err) {
    rethrowDuplicate(err, 'project label');
  }
}

// Deleting a group deletes its child labels (FK cascade); links to projects go too.
export async function deleteProjectLabel(id: string): Promise<boolean> {
  const rows = await db
    .delete(projectLabel)
    .where(eq(projectLabel.id, id))
    .returning({ id: projectLabel.id });
  return rows.length > 0;
}

// Project labels are workspace-level: any user who is a member of at least one
// team may read and manage them (Linear's default). Throws 403 otherwise.
export async function assertLabelManager(userId: string): Promise<void> {
  const rows = await db
    .select({ id: teamMember.teamId })
    .from(teamMember)
    .where(eq(teamMember.userId, userId))
    .limit(1);
  if (rows.length === 0) throw new HttpError(403, 'Project labels need membership in a team');
}
