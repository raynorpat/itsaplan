import { db, initiative, initiativeRelation, initiativeToProject, project } from '@repo/db';
import { and, eq, inArray, isNull, type SQL } from 'drizzle-orm';
import { assertInitiativeAccess, visibleInitiativesSql } from '../../initiatives/access';
import { visibleSubtreeIds } from '../../initiatives/links';
import { initiativeUrl, mapInitiative, type InitiativeRow } from '../../initiatives/store';
import { latestInitiativeUpdate } from '../../initiatives/updates';
import type { GraphQLContext } from '../context';
import { paginate, type PageArgs } from '../connection';
import { gqlError } from '../errors';
import { initiativeFilterSql } from '../initiative-filter';
import { userById } from './issue';
import { guard } from './mutations';
import { getOrganization } from './organization';
import { listProjects } from './project';
import { findTeam, toTeam } from './team';

// Linear's Initiative over the initiative table. Visibility follows the lead team
// (initiatives/access.ts); a relation to an initiative the viewer cannot see
// resolves to null or is left out of a list. Labels, documents, links and history
// are not implemented: the schema's neutral values answer them.

export type ListArgs = PageArgs & {
  filter?: unknown;
  includeArchived?: boolean | null;
  sort?: unknown;
  includeSubInitiatives?: boolean | null;
};

export function toInitiative(row: InitiativeRow) {
  return {
    ...row,
    url: initiativeUrl(row.id),
    visibility: row.leadTeamId ? 'private' : 'public',
    frequencyResolution: 'weekly',
    labelIds: [] as string[],
  };
}

export type GraphQLInitiative = ReturnType<typeof toInitiative>;

// Custom sort orders are not supported; connections order by createdAt or
// updatedAt.
export function rejectSort(args: { sort?: unknown }): void {
  if (args.sort != null) throw gqlError('INVALID_INPUT', 'Argument sort is not supported');
}

// One page of the viewer's visible initiatives matching `where`, the filter and
// includeArchived.
export async function listInitiatives(where: SQL | undefined, args: ListArgs, ctx: GraphQLContext) {
  rejectSort(args);
  return paginate(
    args,
    { id: initiative.id, createdAt: initiative.createdAt, updatedAt: initiative.updatedAt },
    and(
      await visibleInitiativesSql(ctx.user.id),
      where,
      args.includeArchived ? undefined : isNull(initiative.archivedAt),
      initiativeFilterSql(args.filter),
    ),
    (w, order, limit) =>
      db
        .select()
        .from(initiative)
        .where(w)
        .orderBy(...order)
        .limit(limit),
    (row) => toInitiative(mapInitiative(row)),
  );
}

// A visible initiative by id or slug, or ENTITY_NOT_FOUND.
export async function findInitiative(id: string, ctx: GraphQLContext) {
  return guard(async () => toInitiative(await assertInitiativeAccess(id, ctx.user.id, 'read')));
}

// The initiative when the viewer can see it, otherwise null.
export const visibleOrNull = (id: string | null, ctx: GraphQLContext) =>
  id ? findInitiative(id, ctx).catch(() => null) : null;

export const initiativeResolvers = {
  Query: {
    initiative: (_: unknown, { id }: { id: string }, ctx: GraphQLContext) =>
      findInitiative(id, ctx),
    initiatives: (_: unknown, args: ListArgs, ctx: GraphQLContext) =>
      listInitiatives(undefined, args, ctx),
  },
  Initiative: {
    owner: (i: GraphQLInitiative, _: unknown, ctx: GraphQLContext) =>
      userById(i.ownerUserId, ctx.user.id),
    creator: (i: GraphQLInitiative, _: unknown, ctx: GraphQLContext) =>
      userById(i.creatorUserId, ctx.user.id),
    leadTeam: async (i: GraphQLInitiative, _: unknown, ctx: GraphQLContext) =>
      i.leadTeamId
        ? findTeam(i.leadTeamId, ctx.user.id)
            .then(toTeam)
            .catch(() => null)
        : null,
    organization: () => getOrganization(),
    health: async (i: GraphQLInitiative) => (await latestInitiativeUpdate(i.id))?.health ?? null,
    healthUpdatedAt: async (i: GraphQLInitiative) =>
      (await latestInitiativeUpdate(i.id))?.createdAt ?? null,
    parentInitiative: async (i: GraphQLInitiative, _: unknown, ctx: GraphQLContext) => {
      const [row] = await db
        .select({ id: initiativeRelation.initiativeId })
        .from(initiativeRelation)
        .where(eq(initiativeRelation.relatedInitiativeId, i.id));
      return visibleOrNull(row?.id ?? null, ctx);
    },
    subInitiatives: (i: GraphQLInitiative, args: ListArgs, ctx: GraphQLContext) =>
      listInitiatives(
        inArray(
          initiative.id,
          db
            .select({ id: initiativeRelation.relatedInitiativeId })
            .from(initiativeRelation)
            .where(eq(initiativeRelation.initiativeId, i.id)),
        ),
        args,
        ctx,
      ),
    // Projects of the initiative and, unless includeSubInitiatives is false, of its
    // visible descendants; only projects the viewer can see.
    projects: async (i: GraphQLInitiative, args: ListArgs, ctx: GraphQLContext) => {
      rejectSort(args);
      const ids =
        args.includeSubInitiatives === false
          ? [i.id]
          : await visibleSubtreeIds(i.id, await visibleInitiativesSql(ctx.user.id));
      return listProjects(
        inArray(
          project.id,
          db
            .select({ id: initiativeToProject.projectId })
            .from(initiativeToProject)
            .where(inArray(initiativeToProject.initiativeId, ids)),
        ),
        args,
        ctx,
      );
    },
  },
  Project: {
    initiatives: (p: { id: string }, args: ListArgs, ctx: GraphQLContext) =>
      listInitiatives(
        inArray(
          initiative.id,
          db
            .select({ id: initiativeToProject.initiativeId })
            .from(initiativeToProject)
            .where(eq(initiativeToProject.projectId, p.id)),
        ),
        args,
        ctx,
      ),
  },
};
