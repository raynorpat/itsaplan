import { db, aiAgent, project, projectMember, user } from '@repo/db';
import { and, eq, inArray, or, type SQL } from 'drizzle-orm';
import type { GraphQLContext } from '../context';
import { paginate, type PageArgs } from '../connection';
import { gqlError } from '../errors';
import { compare, compareId, filterSql, type FieldHandlers } from '../filter';
import { getOrganization } from './organization';
import { toGraphQLUser } from './user';

// Linear's Team is a project. A team is visible only to its members.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ProjectRecord = typeof project.$inferSelect;

// The projects the user is a member of, as a subquery for `inArray`.
export const visibleProjectIds = (userId: string) =>
  db
    .select({ id: projectMember.projectId })
    .from(projectMember)
    .where(eq(projectMember.userId, userId));

export function toTeam(row: ProjectRecord) {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    displayName: row.name,
    description: row.description,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.createdAt.toISOString(),
    private: false,
    issueCount: 0,
  };
}

// A visible team by uuid or key, or ENTITY_NOT_FOUND.
export async function findTeam(idOrKey: string, userId: string): Promise<ProjectRecord> {
  const match = UUID.test(idOrKey)
    ? eq(project.id, idOrKey)
    : eq(project.key, idOrKey.toUpperCase());
  const rows = await db
    .select()
    .from(project)
    .where(and(match, inArray(project.id, visibleProjectIds(userId))));
  if (!rows[0]) throw gqlError('ENTITY_NOT_FOUND', `Team ${idOrKey} not found`);
  return rows[0];
}

// TeamFilter fields this API supports, as SQL over the project table.
export const teamFilter: FieldHandlers = {
  id: (v, p) => compareId(project.id, v, p),
  key: (v, p) => compare(project.key, v, p),
  name: (v, p) => compare(project.name, v, p),
};

// Users visible to the viewer: themselves, the members of their projects, and the
// agents of their projects.
export function visibleUsers(viewerId: string): SQL {
  const projects = visibleProjectIds(viewerId);
  return or(
    eq(user.id, viewerId),
    inArray(
      user.id,
      db
        .select({ id: projectMember.userId })
        .from(projectMember)
        .where(inArray(projectMember.projectId, projects)),
    ),
    inArray(
      user.id,
      db.select({ id: aiAgent.userId }).from(aiAgent).where(inArray(aiAgent.projectId, projects)),
    ),
  )!;
}

export const userFilter: FieldHandlers = {
  id: (v, p) => compareId(user.id, v, p),
  name: (v, p) => compare(user.name, v, p),
  displayName: (v, p) => compare(user.name, v, p),
  email: (v, p) => compare(user.email, v, p),
};

type ConnectionArgs = PageArgs & { filter?: unknown; includeArchived?: boolean | null };

function listUsers(where: SQL | undefined, args: ConnectionArgs, viewerId: string) {
  return paginate(
    args,
    { id: user.id, createdAt: user.createdAt, updatedAt: user.updatedAt },
    and(where, filterSql(args.filter, userFilter)),
    (w, order, limit) =>
      db
        .select()
        .from(user)
        .where(w)
        .orderBy(...order)
        .limit(limit),
    (row) => toGraphQLUser(row, viewerId),
  );
}

export const teamResolvers = {
  Query: {
    teams: (_: unknown, args: ConnectionArgs, ctx: GraphQLContext) =>
      paginate(
        args,
        { id: project.id, createdAt: project.createdAt, updatedAt: project.createdAt },
        and(
          inArray(project.id, visibleProjectIds(ctx.user.id)),
          filterSql(args.filter, teamFilter),
        ),
        (w, order, limit) =>
          db
            .select()
            .from(project)
            .where(w)
            .orderBy(...order)
            .limit(limit)
            .then((rows) => rows.map((r) => ({ ...r, updatedAt: r.createdAt }))),
        (row) => toTeam(row),
      ),
    team: async (_: unknown, args: { id: string }, ctx: GraphQLContext) =>
      toTeam(await findTeam(args.id, ctx.user.id)),
    users: (_: unknown, args: ConnectionArgs, ctx: GraphQLContext) =>
      listUsers(visibleUsers(ctx.user.id), args, ctx.user.id),
    user: async (_: unknown, args: { id: string }, ctx: GraphQLContext) => {
      const rows = UUID.test(args.id)
        ? await db
            .select()
            .from(user)
            .where(and(eq(user.id, args.id), visibleUsers(ctx.user.id)))
        : [];
      if (!rows[0]) throw gqlError('ENTITY_NOT_FOUND', `User ${args.id} not found`);
      return toGraphQLUser(rows[0], ctx.user.id);
    },
  },
  Team: {
    organization: () => getOrganization(),
    members: (team: { id: string }, args: ConnectionArgs, ctx: GraphQLContext) =>
      listUsers(
        inArray(
          user.id,
          db
            .select({ id: projectMember.userId })
            .from(projectMember)
            .where(eq(projectMember.projectId, team.id)),
        ),
        args,
        ctx.user.id,
      ),
  },
  User: {
    organization: () => getOrganization(),
  },
};
