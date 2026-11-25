import { db, projectRelation } from '@repo/db';
import { and, eq, type SQL } from 'drizzle-orm';
import {
  createRelation,
  deleteRelation,
  mapRelation,
  updateRelation,
  visibleRelationsSql,
  type RelationInput,
  type RelationRow,
} from '../../projects/relations';
import { visibleTeamIdList, workspaceRole } from '../../shared/access';
import { HttpError, UUID_RE } from '../../shared/lib';
import type { GraphQLContext } from '../context';
import { paginate, type PageArgs } from '../connection';
import { gqlError } from '../errors';
import { loaders } from '../loaders';
import { userById } from './issue';
import { guard, lastSyncId, onlySupported } from './mutations';
import { findProject, toMilestone, toProject } from './project';

// Linear's ProjectRelation (projects/relations.ts). A relation is visible when the
// viewer sees both projects and neither is archived. Writing one needs both projects
// visible (ENTITY_NOT_FOUND otherwise) and a role above guest, since guests only read
// relations (FORBIDDEN).

const FIELDS = [
  'type',
  'projectId',
  'anchorType',
  'projectMilestoneId',
  'relatedProjectId',
  'relatedAnchorType',
  'relatedProjectMilestoneId',
];

const toRelation = (r: RelationRow) => ({ ...r, archivedAt: null });

async function listRelations(where: SQL | undefined, args: PageArgs, ctx: GraphQLContext) {
  const teams = await visibleTeamIdList(ctx.user.id);
  return paginate(
    args,
    {
      id: projectRelation.id,
      createdAt: projectRelation.createdAt,
      updatedAt: projectRelation.updatedAt,
    },
    and(visibleRelationsSql(teams), where),
    (w, order, limit) =>
      db
        .select()
        .from(projectRelation)
        .where(w)
        .orderBy(...order)
        .limit(limit),
    (row) => toRelation(mapRelation(row)),
  );
}

async function findRelation(id: string, ctx: GraphQLContext): Promise<RelationRow> {
  const teams = await visibleTeamIdList(ctx.user.id);
  const [row] = UUID_RE.test(id)
    ? await db
        .select()
        .from(projectRelation)
        .where(and(eq(projectRelation.id, id), visibleRelationsSql(teams)))
    : [];
  if (!row) throw gqlError('ENTITY_NOT_FOUND', `Project relation ${id} not found`);
  return mapRelation(row);
}

// Both projects visible (ENTITY_NOT_FOUND), then a role above guest (FORBIDDEN).
async function assertCanRelate(projectId: string, relatedProjectId: string, ctx: GraphQLContext) {
  const a = await findProject(projectId, ctx);
  const b = await findProject(relatedProjectId, ctx);
  if ((await workspaceRole(ctx.user.id)) === 'guest')
    throw new HttpError(403, 'Guests cannot change project dependencies');
  return { projectId: a.id, relatedProjectId: b.id };
}

const payload = (r: RelationRow) => ({
  success: true,
  lastSyncId: lastSyncId(),
  projectRelation: toRelation(r),
});

const projectField =
  (key: 'projectId' | 'relatedProjectId') =>
  async (r: RelationRow, _: unknown, ctx: GraphQLContext) => {
    const found = await loaders(ctx).project.load(r[key]);
    return found ? toProject(found) : null;
  };

const milestoneField =
  (key: 'projectMilestoneId' | 'relatedProjectMilestoneId') =>
  async (r: RelationRow, _: unknown, ctx: GraphQLContext) => {
    const id = r[key];
    if (!id) return null;
    const found = await loaders(ctx).milestone.load(id);
    return found ? toMilestone(found) : null;
  };

export const projectRelationResolvers = {
  Query: {
    projectRelation: (_: unknown, { id }: { id: string }, ctx: GraphQLContext) =>
      guard(async () => toRelation(await findRelation(id, ctx))),
    projectRelations: (_: unknown, args: PageArgs, ctx: GraphQLContext) =>
      listRelations(undefined, args, ctx),
  },
  Project: {
    relations: (p: { id: string }, args: PageArgs, ctx: GraphQLContext) =>
      listRelations(eq(projectRelation.projectId, p.id), args, ctx),
    inverseRelations: (p: { id: string }, args: PageArgs, ctx: GraphQLContext) =>
      listRelations(eq(projectRelation.relatedProjectId, p.id), args, ctx),
  },
  ProjectRelation: {
    project: projectField('projectId'),
    relatedProject: projectField('relatedProjectId'),
    projectMilestone: milestoneField('projectMilestoneId'),
    relatedProjectMilestone: milestoneField('relatedProjectMilestoneId'),
    user: (r: RelationRow, _: unknown, ctx: GraphQLContext) => userById(r.userId, ctx.user.id),
  },
  Mutation: {
    projectRelationCreate: (
      _: unknown,
      { input }: { input: RelationInput & { id?: string | null } },
      ctx: GraphQLContext,
    ) =>
      guard(async () => {
        onlySupported(input as unknown as Record<string, unknown>, [...FIELDS, 'id'], 'input');
        if (input.id != null && !UUID_RE.test(input.id))
          throw gqlError('INVALID_INPUT', 'input.id is not a valid id');
        const ids = await assertCanRelate(input.projectId, input.relatedProjectId, ctx);
        return payload(await createRelation(ctx.user.id, { ...input, ...ids }));
      }),
    projectRelationUpdate: (
      _: unknown,
      { id, input }: { id: string; input: Partial<RelationInput> },
      ctx: GraphQLContext,
    ) =>
      guard(async () => {
        onlySupported(input as unknown as Record<string, unknown>, FIELDS, 'input');
        const current = await findRelation(id, ctx);
        await assertCanRelate(current.projectId, current.relatedProjectId, ctx);
        const ids = await assertCanRelate(
          input.projectId ?? current.projectId,
          input.relatedProjectId ?? current.relatedProjectId,
          ctx,
        );
        return payload(await updateRelation(ctx.user.id, current, { ...input, ...ids }));
      }),
    projectRelationDelete: (_: unknown, { id }: { id: string }, ctx: GraphQLContext) =>
      guard(async () => {
        const current = await findRelation(id, ctx);
        await assertCanRelate(current.projectId, current.relatedProjectId, ctx);
        await deleteRelation(current.id);
        return { success: true, lastSyncId: lastSyncId(), entityId: current.id };
      }),
  },
};
