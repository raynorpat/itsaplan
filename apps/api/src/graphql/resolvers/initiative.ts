import { visibleTeamIdList } from '../../shared/access';
import {
  db,
  initiative,
  initiativeRelation,
  initiativeToProject,
  initiativeUpdate,
  project,
} from '@repo/db';
import { and, eq, getTableColumns, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { projectsInTeams } from '../../projects/access';
import { assertInitiativeAccess, visibleInitiativesSql } from '../../initiatives/access';
import {
  getProjectLink,
  getRelation,
  mapProjectLink,
  mapRelation,
  visibleSubtreeIds,
  type InitiativeRelationRow,
  type InitiativeToProjectRow,
} from '../../initiatives/links';
import { initiativeUrl, mapInitiative, type InitiativeRow } from '../../initiatives/store';
import {
  getInitiativeUpdate,
  latestInitiativeUpdate,
  mapInitiativeUpdate,
  type InitiativeUpdateRow,
} from '../../initiatives/updates';
import type { GraphQLContext } from '../context';
import { paginate, type PageArgs } from '../connection';
import { gqlError } from '../errors';
import { UUID_RE } from '../../shared/lib';
import { initiativeFilterSql, initiativeUpdateFilterSql } from '../initiative-filter';
import { initiativeSortKeys, tieBreaks } from '../list-sorts';
import { paginateSorted } from '../sort';
import { userById } from './issue';
import { guard } from './mutations';
import { getOrganization } from './organization';
import { findProject, listProjects } from './project';
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

// One page of the viewer's visible initiatives matching `where`, the filter and
// includeArchived.
export async function listInitiatives(where: SQL | undefined, args: ListArgs, ctx: GraphQLContext) {
  const scope = and(
    await visibleInitiativesSql(ctx.user.id),
    where,
    args.includeArchived ? undefined : isNull(initiative.archivedAt),
    initiativeFilterSql(args.filter),
  );
  const keys = initiativeSortKeys(args.sort);
  if (keys)
    return paginateSorted(
      args,
      keys,
      tieBreaks.initiative,
      sql`${initiative.id}`,
      scope,
      (w, order, limit, select) =>
        db
          .select({ ...getTableColumns(initiative), sortValues: select })
          .from(initiative)
          .where(w)
          .orderBy(...order)
          .limit(limit),
      (row) => toInitiative(mapInitiative(row)),
    );
  return paginate(
    args,
    { id: initiative.id, createdAt: initiative.createdAt, updatedAt: initiative.updatedAt },
    scope,
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

// The newest unarchived update of an initiative, looked up once per request:
// health, healthUpdatedAt and lastUpdate all read it.
const latestUpdates = new WeakMap<
  GraphQLContext,
  Map<string, Promise<InitiativeUpdateRow | null>>
>();
function latestUpdate(initiativeId: string, ctx: GraphQLContext) {
  let cache = latestUpdates.get(ctx);
  if (!cache) latestUpdates.set(ctx, (cache = new Map()));
  let found = cache.get(initiativeId);
  if (!found) cache.set(initiativeId, (found = latestInitiativeUpdate(initiativeId)));
  return found;
}

// A visible initiative by id or slug, or ENTITY_NOT_FOUND.
export async function findInitiative(id: string, ctx: GraphQLContext) {
  return guard(async () => toInitiative(await assertInitiativeAccess(id, ctx.user.id)));
}

// The initiative when the viewer can see it, otherwise null.
export const visibleOrNull = (id: string | null, ctx: GraphQLContext) =>
  id ? findInitiative(id, ctx).catch(() => null) : null;

export function toInitiativeUpdate(row: InitiativeUpdateRow) {
  return {
    ...row,
    url: initiativeUrl(row.initiativeId),
    // Linear's short update id; this instance derives it from the id.
    slugId: row.id.replace(/-/g, '').slice(0, 12),
    isStale: false,
    isDiffHidden: false,
    diff: null,
    diffMarkdown: null,
  };
}

// InitiativeToProject.sortOrder is a numeric string in Linear's schema.
export const toProjectLink = (row: InitiativeToProjectRow) => ({
  ...row,
  sortOrder: String(row.sortOrder),
});

export const toRelation = (row: InitiativeRelationRow) => row;

// Subquery of the ids of the initiatives matching `visible` (from
// visibleInitiativesSql). Not awaited: awaiting a query builder runs it.
const idsWhere = (visible: SQL) => db.select({ id: initiative.id }).from(initiative).where(visible);

// Links whose initiative and project are both visible; links to archived
// initiatives only with includeArchived.
async function listProjectLinks(where: SQL | undefined, args: ListArgs, ctx: GraphQLContext) {
  const projects = projectsInTeams(await visibleTeamIdList(ctx.user.id));
  return paginate(
    args,
    {
      id: initiativeToProject.id,
      createdAt: initiativeToProject.createdAt,
      updatedAt: initiativeToProject.updatedAt,
    },
    and(
      inArray(
        initiativeToProject.initiativeId,
        idsWhere(
          and(
            await visibleInitiativesSql(ctx.user.id),
            args.includeArchived ? undefined : isNull(initiative.archivedAt),
          )!,
        ),
      ),
      inArray(initiativeToProject.projectId, projects),
      where,
    ),
    (w, order, limit) =>
      db
        .select()
        .from(initiativeToProject)
        .where(w)
        .orderBy(...order)
        .limit(limit),
    (row) => toProjectLink(mapProjectLink(row)),
  );
}

// Relations whose parent and child are both visible.
async function listRelations(where: SQL | undefined, args: PageArgs, ctx: GraphQLContext) {
  const visible = idsWhere(await visibleInitiativesSql(ctx.user.id));
  return paginate(
    args,
    {
      id: initiativeRelation.id,
      createdAt: initiativeRelation.createdAt,
      updatedAt: initiativeRelation.updatedAt,
    },
    and(
      inArray(initiativeRelation.initiativeId, visible),
      inArray(initiativeRelation.relatedInitiativeId, visible),
      where,
    ),
    (w, order, limit) =>
      db
        .select()
        .from(initiativeRelation)
        .where(w)
        .orderBy(...order)
        .limit(limit),
    (row) => toRelation(mapRelation(row)),
  );
}

async function listInitiativeUpdates(where: SQL | undefined, args: ListArgs, ctx: GraphQLContext) {
  return paginate(
    args,
    {
      id: initiativeUpdate.id,
      createdAt: initiativeUpdate.createdAt,
      updatedAt: initiativeUpdate.updatedAt,
    },
    and(
      inArray(initiativeUpdate.initiativeId, idsWhere(await visibleInitiativesSql(ctx.user.id))),
      where,
      args.includeArchived ? undefined : isNull(initiativeUpdate.archivedAt),
      initiativeUpdateFilterSql(args.filter),
    ),
    (w, order, limit) =>
      db
        .select()
        .from(initiativeUpdate)
        .where(w)
        .orderBy(...order)
        .limit(limit),
    (row) => toInitiativeUpdate(mapInitiativeUpdate(row)),
  );
}

// A link the viewer can see (initiative and project visible), or ENTITY_NOT_FOUND.
export async function findProjectLink(id: string, ctx: GraphQLContext) {
  return guard(async () => {
    const link = UUID_RE.test(id) ? await getProjectLink(id) : null;
    if (!link) throw gqlError('ENTITY_NOT_FOUND', `Initiative to project ${id} not found`);
    await assertInitiativeAccess(link.initiativeId, ctx.user.id);
    await findProject(link.projectId, ctx);
    return link;
  });
}

// A relation the viewer can see (both initiatives visible), or ENTITY_NOT_FOUND.
export async function findRelation(id: string, ctx: GraphQLContext) {
  return guard(async () => {
    const relation = UUID_RE.test(id) ? await getRelation(id) : null;
    if (!relation) throw gqlError('ENTITY_NOT_FOUND', `Initiative relation ${id} not found`);
    await assertInitiativeAccess(relation.initiativeId, ctx.user.id);
    await assertInitiativeAccess(relation.relatedInitiativeId, ctx.user.id);
    return relation;
  });
}

// An update of a visible initiative, or ENTITY_NOT_FOUND.
export async function findInitiativeUpdate(id: string, ctx: GraphQLContext) {
  return guard(async () => {
    const found = UUID_RE.test(id) ? await getInitiativeUpdate(id) : null;
    if (!found) throw gqlError('ENTITY_NOT_FOUND', `Initiative update ${id} not found`);
    await assertInitiativeAccess(found.initiativeId, ctx.user.id);
    return found;
  });
}

export const initiativeResolvers = {
  Query: {
    initiative: (_: unknown, { id }: { id: string }, ctx: GraphQLContext) =>
      findInitiative(id, ctx),
    initiatives: (_: unknown, args: ListArgs, ctx: GraphQLContext) =>
      listInitiatives(undefined, args, ctx),
    initiativeToProject: async (_: unknown, { id }: { id: string }, ctx: GraphQLContext) =>
      toProjectLink(await findProjectLink(id, ctx)),
    initiativeToProjects: (_: unknown, args: ListArgs, ctx: GraphQLContext) =>
      listProjectLinks(undefined, args, ctx),
    initiativeRelation: async (_: unknown, { id }: { id: string }, ctx: GraphQLContext) =>
      toRelation(await findRelation(id, ctx)),
    initiativeRelations: (_: unknown, args: PageArgs, ctx: GraphQLContext) =>
      listRelations(undefined, args, ctx),
    initiativeUpdate: async (_: unknown, { id }: { id: string }, ctx: GraphQLContext) =>
      toInitiativeUpdate(await findInitiativeUpdate(id, ctx)),
    initiativeUpdates: (_: unknown, args: ListArgs, ctx: GraphQLContext) =>
      listInitiativeUpdates(undefined, args, ctx),
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
    health: async (i: GraphQLInitiative, _: unknown, ctx: GraphQLContext) =>
      (await latestUpdate(i.id, ctx))?.health ?? null,
    healthUpdatedAt: async (i: GraphQLInitiative, _: unknown, ctx: GraphQLContext) =>
      (await latestUpdate(i.id, ctx))?.createdAt ?? null,
    lastUpdate: async (i: GraphQLInitiative, _: unknown, ctx: GraphQLContext) => {
      const last = await latestUpdate(i.id, ctx);
      return last ? toInitiativeUpdate(last) : null;
    },
    initiativeUpdates: (i: GraphQLInitiative, args: ListArgs, ctx: GraphQLContext) =>
      listInitiativeUpdates(eq(initiativeUpdate.initiativeId, i.id), args, ctx),
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
  InitiativeToProject: {
    initiative: (l: { initiativeId: string }, _: unknown, ctx: GraphQLContext) =>
      findInitiative(l.initiativeId, ctx),
    project: (l: { projectId: string }, _: unknown, ctx: GraphQLContext) =>
      findProject(l.projectId, ctx),
  },
  InitiativeRelation: {
    initiative: (r: InitiativeRelationRow, _: unknown, ctx: GraphQLContext) =>
      findInitiative(r.initiativeId, ctx),
    relatedInitiative: (r: InitiativeRelationRow, _: unknown, ctx: GraphQLContext) =>
      findInitiative(r.relatedInitiativeId, ctx),
    user: (r: InitiativeRelationRow, _: unknown, ctx: GraphQLContext) =>
      userById(r.userId, ctx.user.id),
  },
  InitiativeUpdate: {
    initiative: (u: { initiativeId: string }, _: unknown, ctx: GraphQLContext) =>
      findInitiative(u.initiativeId, ctx),
    user: (u: { userId: string | null }, _: unknown, ctx: GraphQLContext) =>
      userById(u.userId, ctx.user.id),
  },
  Project: {
    initiativeToProjects: (p: { id: string }, args: ListArgs, ctx: GraphQLContext) =>
      listProjectLinks(eq(initiativeToProject.projectId, p.id), args, ctx),
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
