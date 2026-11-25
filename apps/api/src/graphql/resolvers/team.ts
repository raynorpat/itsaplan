import { APP_ROLE } from '@repo/auth';
import { db, team, teamMember, user } from '@repo/db';
import { and, eq, inArray, ne, notInArray, or, sql, type SQL } from 'drizzle-orm';
import {
  memberTeamIds,
  publicTeamAppUserIds,
  seesPublicTeams,
  unofferedAppUserIds,
  visibleTeamIds,
} from '../../shared/access';
import type { GraphQLContext } from '../context';
import { paginate, type PageArgs } from '../connection';
import { gqlError } from '../errors';
import { newestFirst, paginateSorted, parseCaselessSort, type SortBuilder } from '../sort';
import { compare, compareId, filterSql, type FieldHandlers } from '../filter';
import { getOrganization } from './organization';
import { toGraphQLUser } from './user';
import { UUID_RE } from '../../shared/lib';
import { shownNameSql } from '../../shared/user-name';

// Linear's Team is a team. Owners, admins and members see every public team and
// their private teams; guests see their teams (shared/access.ts).

type TeamRecord = typeof team.$inferSelect;

export { visibleTeamIds };

export function toTeam(row: TeamRecord) {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    displayName: row.name,
    description: row.description,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.createdAt.toISOString(),
    private: row.visibility === 'private',
    visibility: row.visibility,
    cyclesEnabled: row.cyclesEnabled,
    cycleDuration: row.cycleDuration,
    cycleStartDay: row.cycleStartDay,
    cycleCooldownTime: row.cycleCooldownTime,
    upcomingCycleCount: row.upcomingCycleCount,
    cycleIssueAutoAssignStarted: row.cycleIssueAutoAssignStarted,
    cycleIssueAutoAssignCompleted: row.cycleIssueAutoAssignCompleted,
    autoArchivePeriod: row.autoArchivePeriod,
    issueEstimationType: row.issueEstimationType,
    issueEstimationExtended: row.issueEstimationExtended,
    issueEstimationAllowZero: row.issueEstimationAllowZero,
    defaultIssueEstimate: row.defaultIssueEstimate,
    // Sub-teams are not implemented.
    inheritIssueEstimation: false,
    // Auto-close is not offered.
    autoClosePeriod: 0,
    autoCloseStateId: null,
  };
}

// A visible team by uuid or key, or ENTITY_NOT_FOUND.
export async function findTeam(idOrKey: string, userId: string): Promise<TeamRecord> {
  const match = UUID_RE.test(idOrKey) ? eq(team.id, idOrKey) : eq(team.key, idOrKey.toUpperCase());
  const rows = await db
    .select()
    .from(team)
    .where(and(match, inArray(team.id, visibleTeamIds(userId))));
  if (!rows[0]) throw gqlError('ENTITY_NOT_FOUND', `Team ${idOrKey} not found`);
  return rows[0];
}

// TeamFilter fields this API supports, as SQL over the team table.
export const teamFilter: FieldHandlers = {
  id: (v, p) => compareId(team.id, v, p),
  key: (v, p) => compare(team.key, v, p),
  name: (v, p) => compare(team.name, v, p),
};

// Users visible to the viewer: every workspace user for owners, admins and
// members (and app users with every public team); for a guest, themselves and the
// members of their teams.
export function visibleUsers(viewerId: string): SQL {
  return or(
    eq(user.id, viewerId),
    sql`EXISTS (${seesPublicTeams(viewerId)})`,
    inArray(
      user.id,
      db
        .select({ id: teamMember.userId })
        .from(teamMember)
        .where(inArray(teamMember.teamId, memberTeamIds(viewerId))),
    ),
  )!;
}

export const userFilter: FieldHandlers = {
  id: (v, p) => compareId(user.id, v, p),
  name: (v, p) => compare(shownNameSql, v, p),
  displayName: (v, p) => compare(shownNameSql, v, p),
  email: (v, p) => compare(user.email, v, p),
  // Linear's `app`: whether the user is an app user (an installed OAuth application).
  app: (v, p) => {
    const parts: SQL[] = [];
    for (const [op, value] of Object.entries((v ?? {}) as Record<string, unknown>)) {
      if (value === undefined || value === null) continue;
      if ((op !== 'eq' && op !== 'neq') || typeof value !== 'boolean')
        throw gqlError('INVALID_INPUT', `Filter ${p}.${op} is not supported`);
      parts.push(
        (op === 'eq') === value
          ? eq(user.workspaceRole, APP_ROLE)
          : ne(user.workspaceRole, APP_ROLE),
      );
    }
    return and(...parts) ?? sql`true`;
  },
};

type ConnectionArgs = PageArgs & {
  filter?: unknown;
  includeArchived?: boolean | null;
  sort?: unknown;
};

// Linear's UserSortInput. A user's name and display name are the same shown name here
// (`shownNameSql`), so both keys order by it.
const userSorts: Record<string, SortBuilder> = {
  name: () => [{ sql: shownNameSql, type: 'text' }],
  displayName: () => [{ sql: shownNameSql, type: 'text' }],
};

export function listUsers(where: SQL | undefined, args: ConnectionArgs, viewerId: string) {
  const keys = parseCaselessSort(args.sort, userSorts);
  if (keys)
    return paginateSorted(
      args,
      keys,
      newestFirst(sql`${user.createdAt}`),
      sql`${user.id}`,
      and(where, filterSql(args.filter, userFilter)),
      (w, values) => db.select(values).from(user).where(w),
      (ids, w) =>
        db
          .select()
          .from(user)
          .where(and(w, inArray(user.id, ids))),
      (row) => toGraphQLUser(row, viewerId),
    );
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
        { id: team.id, createdAt: team.createdAt, updatedAt: team.createdAt },
        and(inArray(team.id, visibleTeamIds(ctx.user.id)), filterSql(args.filter, teamFilter)),
        (w, order, limit) =>
          db
            .select()
            .from(team)
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
      const rows = UUID_RE.test(args.id)
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
    // The people of the team, as the pickers offer them: an app user only when its
    // install granted `app:assignable` or `app:mentionable`. An app user installed
    // with every public team is a member of each public team.
    members: (
      team: { id: string; visibility?: string },
      args: ConnectionArgs,
      ctx: GraphQLContext,
    ) => {
      const memberIds = inArray(
        user.id,
        db.select({ id: teamMember.userId }).from(teamMember).where(eq(teamMember.teamId, team.id)),
      );
      return listUsers(
        and(
          team.visibility === 'public'
            ? or(memberIds, inArray(user.id, publicTeamAppUserIds()))
            : memberIds,
          notInArray(user.id, unofferedAppUserIds()),
        ),
        args,
        ctx.user.id,
      );
    },
  },
  User: {
    organization: () => getOrganization(),
  },
};
