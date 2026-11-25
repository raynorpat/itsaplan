import { db, issue, team, user } from '@repo/db';
import { trustedOrigins } from '@repo/auth';
import { and, eq, getTableColumns, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { GraphQLContext } from '../context';
import { paginate, paginateByValue, type PageArgs } from '../connection';
import { customerCountSql } from '../../feedback/store';
import { gqlError } from '../errors';
import { loaders } from '../loaders';
import { issueFilterSql } from '../issue-filter';
import { findTeam, toTeam, visibleTeamIds, visibleUsers } from './team';
import { toGraphQLUser } from './user';
import { toWorkflowState } from './workflow-state';
import { UUID_RE } from '../../shared/lib';

// Linear's Issue over the issue table. Fields the app has no data for resolve to
// their neutral value (see schema.ts).

// Sequence numbers are int4; more than 9 digits can never match.
const IDENTIFIER = /^([A-Za-z0-9]+)-(\d{1,9})$/;

const PRIORITY_LABEL = ['No priority', 'Urgent', 'High', 'Medium', 'Low'];

const issueColumns = { ...getTableColumns(issue), teamKey: team.key };
type IssueRecord = typeof issue.$inferSelect & { teamKey: string };

const issueSelect = () =>
  db.select(issueColumns).from(issue).innerJoin(team, eq(team.id, issue.teamId));

const iso = (d: Date | null) => (d ? d.toISOString() : null);

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function toIssue(row: IssueRecord) {
  const identifier = `${row.teamKey}-${row.sequenceNumber}`;
  return {
    id: row.id,
    identifier,
    number: row.sequenceNumber,
    title: row.title,
    description: row.description,
    priority: row.priority,
    priorityLabel: PRIORITY_LABEL[row.priority] ?? 'No priority',
    // Linear sorts "no priority" after low.
    prioritySortOrder: row.priority === 0 ? 5 : row.priority,
    estimate: row.estimate,
    sortOrder: row.position,
    boardOrder: row.position,
    dueDate: row.dueDate,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    archivedAt: iso(row.archivedAt),
    startedAt: iso(row.startedAt),
    completedAt: iso(row.completedAt),
    canceledAt: iso(row.canceledAt),
    url: `${trustedOrigins[0]}/team/${row.teamKey}/issue/${row.sequenceNumber}`,
    branchName: `${identifier.toLowerCase()}-${slug(row.title)}`.slice(0, 60).replace(/-+$/, ''),
    trashed: false,
    // Read by the Issue relation resolvers; not schema fields.
    teamId: row.teamId,
    stateId: row.stateId,
    parentId: row.parentId,
    projectId: row.projectId,
    projectMilestoneId: row.projectMilestoneId,
    cycleId: row.cycleId,
    assigneeUserId: row.assigneeUserId,
    delegateUserId: row.delegateUserId,
    creatorUserId: row.creatorUserId,
    externalUserCreatorId: row.externalUserCreatorId,
  };
}

type GraphQLIssue = ReturnType<typeof toIssue>;

// An issue by id without the visibility check, for reading back after a write the
// caller has already authorized. Null when it does not exist.
export async function issueById(id: string): Promise<GraphQLIssue | null> {
  const [row] = await issueSelect().where(eq(issue.id, id));
  return row ? toIssue(row) : null;
}

// A visible issue by uuid or identifier ("MKT-42", any case), or ENTITY_NOT_FOUND.
export async function findIssue(idOrIdentifier: string, userId: string): Promise<IssueRecord> {
  let match: SQL | undefined;
  if (UUID_RE.test(idOrIdentifier)) match = eq(issue.id, idOrIdentifier);
  else {
    const m = IDENTIFIER.exec(idOrIdentifier);
    if (m) match = and(eq(team.key, m[1]!.toUpperCase()), eq(issue.sequenceNumber, Number(m[2])));
  }
  const rows = match
    ? await issueSelect().where(and(match, inArray(issue.teamId, visibleTeamIds(userId))))
    : [];
  if (!rows[0]) throw gqlError('ENTITY_NOT_FOUND', `Issue ${idOrIdentifier} not found`);
  return rows[0];
}

type ConnectionArgs = PageArgs & {
  filter?: unknown;
  includeArchived?: boolean | null;
  sort?: Record<string, { order?: string | null } | null>[] | null;
};

// Linear's IssueSortInput: only customerCount and customerImportantCount
// (feedback/store.ts customerCountSql) are supported, one at a time. Null when
// no sort is given.
function countSort(sort: ConnectionArgs['sort']) {
  if (!sort || sort.length === 0) return null;
  const keys = sort.flatMap((entry) => Object.keys(entry ?? {}).filter((k) => entry?.[k] != null));
  const [key] = keys;
  if (keys.length !== 1 || (key !== 'customerCount' && key !== 'customerImportantCount'))
    throw gqlError(
      'INVALID_INPUT',
      'sort supports one of customerCount or customerImportantCount only',
    );
  const order = sort.find((e) => e?.[key] != null)![key]!.order;
  return {
    value: customerCountSql(key === 'customerImportantCount'),
    direction: order === 'Ascending' ? ('asc' as const) : ('desc' as const),
  };
}

// The viewer's visible issues matching `where`, the filter and includeArchived.
function issueScope(where: SQL | undefined, args: ConnectionArgs, viewerId: string) {
  return and(
    inArray(issue.teamId, visibleTeamIds(viewerId)),
    where,
    args.includeArchived ? undefined : isNull(issue.archivedAt),
    issueFilterSql(args.filter, viewerId),
  );
}

// One page of the issues issueScope selects, in Linear's order or by a count sort.
export function listIssues(where: SQL | undefined, args: ConnectionArgs, viewerId: string) {
  const sorted = countSort(args.sort);
  if (sorted)
    return paginateByValue(
      args,
      { id: issue.id, createdAt: issue.createdAt },
      sorted.value,
      sorted.direction,
      issueScope(where, args, viewerId),
      (w, order, limit) =>
        db
          .select({ ...issueColumns, sortValue: sorted.value })
          .from(issue)
          .innerJoin(team, eq(team.id, issue.teamId))
          .where(w)
          .orderBy(...order)
          .limit(limit),
      (row) => toIssue(row),
    );
  return paginate(
    args,
    { id: issue.id, createdAt: issue.createdAt, updatedAt: issue.updatedAt },
    issueScope(where, args, viewerId),
    (w, order, limit) =>
      issueSelect()
        .where(w)
        .orderBy(...order)
        .limit(limit),
    (row) => toIssue(row),
  );
}

// A user the viewer may see, through the request's user loader, or null.
export async function userFor(ctx: GraphQLContext, id: string | null) {
  if (!id) return null;
  const row = await loaders(ctx).user.load(id);
  return row ? toGraphQLUser(row, ctx.user.id) : null;
}

// A user the viewer may see (see visibleUsers), or null. A former member who no
// longer shares a team with the viewer resolves to null, as user(id:) does.
export async function userById(id: string | null, viewerId: string) {
  if (!id) return null;
  const [row] = await db
    .select()
    .from(user)
    .where(and(eq(user.id, id), visibleUsers(viewerId)));
  return row ? toGraphQLUser(row, viewerId) : null;
}

// Relation fields of an Issue, shared with IssueSearchResult (an issue plus search
// metadata).
const issueRelations = {
  team: async (i: GraphQLIssue, _: unknown, ctx: GraphQLContext) =>
    toTeam((await loaders(ctx).team.load(i.teamId))!),
  state: async (i: GraphQLIssue, _: unknown, ctx: GraphQLContext) =>
    toWorkflowState((await loaders(ctx).state.load(i.stateId))!),
  parent: async (i: GraphQLIssue, _: unknown, ctx: GraphQLContext) => {
    if (!i.parentId) return null;
    const row = await loaders(ctx).issue.load(i.parentId);
    return row ? toIssue(row) : null;
  },
  children: (i: GraphQLIssue, args: ConnectionArgs, ctx: GraphQLContext) =>
    listIssues(eq(issue.parentId, i.id), args, ctx.user.id),
  assignee: (i: GraphQLIssue, _: unknown, ctx: GraphQLContext) => userFor(ctx, i.assigneeUserId),
  delegate: (i: GraphQLIssue, _: unknown, ctx: GraphQLContext) => userFor(ctx, i.delegateUserId),
  creator: (i: GraphQLIssue, _: unknown, ctx: GraphQLContext) => userFor(ctx, i.creatorUserId),
};

// The issue number in a search term, as Linear's search reads it: a bare number
// ("42") matches that number in every team, an identifier ("KEY-42") only in the team
// with that key (any case). Anything else matches no number.
function numberMatch(term: string): SQL | undefined {
  const raw = term.trim();
  if (/^\d+$/.test(raw)) return eq(issue.sequenceNumber, Number(raw));
  const m = raw.match(/^([A-Za-z][A-Za-z0-9]*)-(\d+)$/);
  if (!m) return undefined;
  return and(
    eq(issue.sequenceNumber, Number(m[2])),
    inArray(
      issue.teamId,
      db
        .select({ id: team.id })
        .from(team)
        .where(sql`lower(${team.key}) = ${m[1]!.toLowerCase()}`),
    ),
  );
}

export const issueResolvers = {
  Query: {
    issue: async (_: unknown, args: { id: string }, ctx: GraphQLContext) =>
      toIssue(await findIssue(args.id, ctx.user.id)),
    issues: (_: unknown, args: ConnectionArgs, ctx: GraphQLContext) =>
      listIssues(undefined, args, ctx.user.id),
    // teamId takes a team id or key; an unknown team matches nothing. totalCount is
    // the number of matches across all pages.
    searchIssues: async (
      _: unknown,
      args: ConnectionArgs & { term: string; teamId?: string | null },
      ctx: GraphQLContext,
    ) => {
      const pattern = `%${args.term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      let team: SQL | undefined;
      if (args.teamId) {
        const found = await findTeam(args.teamId, ctx.user.id).catch(() => null);
        team = found ? eq(issue.teamId, found.id) : sql`false`;
      }
      const where = and(
        or(ilike(issue.title, pattern), ilike(issue.description, pattern), numberMatch(args.term)),
        team,
      );
      const page = await listIssues(where, args, ctx.user.id);
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(issue)
        .where(issueScope(where, args, ctx.user.id));
      return { ...page, totalCount: count };
    },
  },
  Issue: issueRelations,
  IssueSearchResult: issueRelations,
  Team: {
    issueCount: async (team: { id: string }) => {
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(issue)
        .where(eq(issue.teamId, team.id));
      return count;
    },
    issues: (team: { id: string }, args: ConnectionArgs, ctx: GraphQLContext) =>
      listIssues(eq(issue.teamId, team.id), args, ctx.user.id),
  },
  WorkflowState: {
    issues: (state: { id: string }, args: ConnectionArgs, ctx: GraphQLContext) =>
      listIssues(eq(issue.stateId, state.id), args, ctx.user.id),
  },
  User: {
    assignedIssues: (u: { id: string }, args: ConnectionArgs, ctx: GraphQLContext) =>
      listIssues(eq(issue.assigneeUserId, u.id), args, ctx.user.id),
  },
};
