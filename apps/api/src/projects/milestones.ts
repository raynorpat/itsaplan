import { db, issue, projectMilestone } from '@repo/db';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { iso, num } from '../shared/lib';

// Project milestones (Linear's ProjectMilestone). An issue's milestone must belong
// to the issue's project (enforced by the issue store).

export interface MilestoneRow {
  id: string;
  projectId: string;
  name: string;
  description: string;
  targetDate: string | null;
  sortOrder: number;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function mapMilestone(row: typeof projectMilestone.$inferSelect): MilestoneRow {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    description: row.description,
    targetDate: row.targetDate,
    sortOrder: num(row.sortOrder),
    archivedAt: row.archivedAt ? iso(row.archivedAt) : null,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export async function listMilestones(projectId: string): Promise<MilestoneRow[]> {
  const rows = await db
    .select()
    .from(projectMilestone)
    .where(and(eq(projectMilestone.projectId, projectId), isNull(projectMilestone.archivedAt)))
    .orderBy(asc(projectMilestone.sortOrder), asc(projectMilestone.createdAt));
  return rows.map(mapMilestone);
}

export async function getMilestone(id: string): Promise<MilestoneRow | null> {
  const [row] = await db.select().from(projectMilestone).where(eq(projectMilestone.id, id));
  return row ? mapMilestone(row) : null;
}

export interface NewMilestoneInput {
  name: string;
  description?: string;
  targetDate?: string | null;
  // Omit or 0 to append after the project's last milestone.
  sortOrder?: number;
}

export async function createMilestone(
  projectId: string,
  input: NewMilestoneInput,
): Promise<MilestoneRow> {
  let sortOrder = input.sortOrder;
  if (!sortOrder) {
    const [{ pos }] = await db
      .select({ pos: sql<number>`COALESCE(MAX(${projectMilestone.sortOrder}), 0) + 1000` })
      .from(projectMilestone)
      .where(eq(projectMilestone.projectId, projectId));
    sortOrder = Number(pos);
  }
  const [row] = await db
    .insert(projectMilestone)
    .values({
      projectId,
      name: input.name,
      description: input.description ?? '',
      targetDate: input.targetDate ?? null,
      sortOrder,
    })
    .returning();
  return mapMilestone(row!);
}

export type MilestonePatch = Partial<NewMilestoneInput>;

export async function updateMilestone(
  id: string,
  patch: MilestonePatch,
): Promise<MilestoneRow | null> {
  const [row] = await db
    .update(projectMilestone)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(projectMilestone.id, id))
    .returning();
  return row ? mapMilestone(row) : null;
}

// Issues in the milestone keep existing with the milestone cleared (FK set null).
export async function deleteMilestone(id: string): Promise<boolean> {
  const rows = await db
    .delete(projectMilestone)
    .where(eq(projectMilestone.id, id))
    .returning({ id: projectMilestone.id });
  return rows.length > 0;
}

// The project a milestone belongs to, or null when it does not exist.
export async function milestoneProjectId(id: string): Promise<string | null> {
  const [row] = await db
    .select({ projectId: projectMilestone.projectId })
    .from(projectMilestone)
    .where(eq(projectMilestone.id, id));
  return row?.projectId ?? null;
}

// Number of issues in a milestone.
export async function milestoneIssueCount(id: string): Promise<number> {
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(issue)
    .where(eq(issue.projectMilestoneId, id));
  return n;
}
