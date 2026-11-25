import { db, project, projectMilestone, projectRelation } from '@repo/db';
import { and, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { HttpError, iso, pgErrorCode, UUID_RE } from '../shared/lib';
import { projectsInTeams } from './access';

// Linear's ProjectRelation: a dependency where the project's anchor (`start` its start
// date, `end` its target date, `milestone` one of its milestones) blocks the related
// project's anchor. The resolvers check that the user sees both projects and may edit;
// this module checks the relation itself: the anchors, the milestones, no relation to
// the same project, one relation per pair of anchors and no cycle between projects.

export const ANCHOR_TYPES = ['start', 'end', 'milestone'] as const;
export type AnchorType = (typeof ANCHOR_TYPES)[number];

export interface RelationRow {
  id: string;
  type: string;
  projectId: string;
  anchorType: AnchorType;
  projectMilestoneId: string | null;
  relatedProjectId: string;
  relatedAnchorType: AnchorType;
  relatedProjectMilestoneId: string | null;
  userId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RelationInput {
  type?: string | null;
  projectId: string;
  anchorType: string;
  projectMilestoneId?: string | null;
  relatedProjectId: string;
  relatedAnchorType: string;
  relatedProjectMilestoneId?: string | null;
}

export function mapRelation(row: typeof projectRelation.$inferSelect): RelationRow {
  return {
    id: row.id,
    type: row.type,
    projectId: row.projectId,
    anchorType: row.anchorType as AnchorType,
    projectMilestoneId: row.projectMilestoneId,
    relatedProjectId: row.relatedProjectId,
    relatedAnchorType: row.relatedAnchorType as AnchorType,
    relatedProjectMilestoneId: row.relatedProjectMilestoneId,
    userId: row.userId,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

// The relations the user sees: both projects in a team the user sees and neither
// archived nor trashed (an archived project's relations come back when it is restored).
export function visibleRelationsSql(teamIds: string[]): SQL {
  const open = db
    .select({ id: project.id })
    .from(project)
    .where(and(inArray(project.id, projectsInTeams(teamIds)), isNull(project.archivedAt)));
  return and(
    inArray(projectRelation.projectId, open),
    inArray(projectRelation.relatedProjectId, open),
  )!;
}

function anchorOf(value: unknown, path: string): AnchorType {
  if (!ANCHOR_TYPES.includes(value as AnchorType))
    throw new HttpError(400, `${path} must be one of ${ANCHOR_TYPES.join(', ')}`);
  return value as AnchorType;
}

// A milestone anchor names a milestone of that project; other anchors name none.
async function milestoneOf(
  anchor: AnchorType,
  milestoneId: string | null | undefined,
  projectId: string,
  path: string,
): Promise<string | null> {
  if (anchor !== 'milestone') {
    if (milestoneId != null) throw new HttpError(400, `${path} is only for a milestone anchor`);
    return null;
  }
  if (milestoneId == null || !UUID_RE.test(milestoneId))
    throw new HttpError(400, `${path} is required for a milestone anchor`);
  const [row] = await db
    .select({ projectId: projectMilestone.projectId })
    .from(projectMilestone)
    .where(eq(projectMilestone.id, milestoneId));
  if (!row || row.projectId !== projectId)
    throw new HttpError(400, `${path} must be a milestone of the project`);
  return milestoneId;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Whether `fromProjectId` already blocks `toProjectId`, directly or through other
// projects, leaving out the relation being changed.
async function blocks(tx: Tx, fromProjectId: string, toProjectId: string, exceptId?: string) {
  const except = exceptId ? sql`AND id <> ${exceptId}` : sql``;
  const rows = await tx.execute<{ found: boolean }>(sql`
    WITH RECURSIVE reach(project_id) AS (
      SELECT related_project_id FROM project_relation
      WHERE project_id = ${fromProjectId} ${except}
      UNION
      SELECT r.related_project_id FROM project_relation r
      JOIN reach ON r.project_id = reach.project_id
      WHERE true ${exceptId ? sql`AND r.id <> ${exceptId}` : sql``}
    )
    SELECT EXISTS (SELECT 1 FROM reach WHERE project_id = ${toProjectId}) AS found
  `);
  return Boolean(rows[0]?.found);
}

async function checked(input: RelationInput) {
  if (input.type != null && input.type !== 'dependency')
    throw new HttpError(400, 'type must be dependency');
  if (input.projectId === input.relatedProjectId)
    throw new HttpError(400, 'A project cannot depend on itself');
  const anchorType = anchorOf(input.anchorType, 'anchorType');
  const relatedAnchorType = anchorOf(input.relatedAnchorType, 'relatedAnchorType');
  return {
    type: 'dependency',
    projectId: input.projectId,
    anchorType,
    projectMilestoneId: await milestoneOf(
      anchorType,
      input.projectMilestoneId,
      input.projectId,
      'projectMilestoneId',
    ),
    relatedProjectId: input.relatedProjectId,
    relatedAnchorType,
    relatedProjectMilestoneId: await milestoneOf(
      relatedAnchorType,
      input.relatedProjectMilestoneId,
      input.relatedProjectId,
      'relatedProjectMilestoneId',
    ),
  };
}

// One writer of relations at a time, so two writes cannot close a cycle together.
async function write<T>(run: (tx: Tx) => Promise<T>): Promise<T> {
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('project-relations'))`);
      return run(tx);
    });
  } catch (err) {
    const code = pgErrorCode(err);
    if (code === '23505') throw new HttpError(409, 'These projects already have this dependency');
    // A project or milestone deleted while the relation was being written.
    if (code === '23503')
      throw new HttpError(400, 'The project or milestone of this dependency no longer exists');
    throw err;
  }
}

function assertNoCycle(found: boolean) {
  if (found) throw new HttpError(400, 'This dependency would create a cycle between projects');
}

export async function createRelation(
  userId: string,
  input: RelationInput & { id?: string | null },
): Promise<RelationRow> {
  return write(async (tx) => {
    const values = await checked(input);
    if (input.id) {
      const [taken] = await tx
        .select({ id: projectRelation.id })
        .from(projectRelation)
        .where(eq(projectRelation.id, input.id));
      if (taken) throw new HttpError(409, 'The id is already used by another project relation');
    }
    assertNoCycle(await blocks(tx, values.relatedProjectId, values.projectId));
    const [row] = await tx
      .insert(projectRelation)
      .values({ ...(input.id ? { id: input.id } : {}), ...values, userId })
      .returning();
    return mapRelation(row!);
  });
}

export async function updateRelation(
  userId: string,
  current: RelationRow,
  patch: Partial<RelationInput>,
): Promise<RelationRow> {
  const next = {
    type: patch.type ?? current.type,
    projectId: patch.projectId ?? current.projectId,
    anchorType: patch.anchorType ?? current.anchorType,
    projectMilestoneId:
      patch.projectMilestoneId !== undefined
        ? patch.projectMilestoneId
        : (patch.anchorType ?? current.anchorType) === 'milestone'
          ? current.projectMilestoneId
          : null,
    relatedProjectId: patch.relatedProjectId ?? current.relatedProjectId,
    relatedAnchorType: patch.relatedAnchorType ?? current.relatedAnchorType,
    relatedProjectMilestoneId:
      patch.relatedProjectMilestoneId !== undefined
        ? patch.relatedProjectMilestoneId
        : (patch.relatedAnchorType ?? current.relatedAnchorType) === 'milestone'
          ? current.relatedProjectMilestoneId
          : null,
  };
  return write(async (tx) => {
    const values = await checked(next);
    assertNoCycle(await blocks(tx, values.relatedProjectId, values.projectId, current.id));
    const [row] = await tx
      .update(projectRelation)
      .set({ ...values, userId, updatedAt: new Date() })
      .where(eq(projectRelation.id, current.id))
      .returning();
    if (!row) throw new HttpError(404, 'Project relation not found');
    return mapRelation(row);
  });
}

export async function deleteRelation(id: string): Promise<void> {
  await db.delete(projectRelation).where(eq(projectRelation.id, id));
}
