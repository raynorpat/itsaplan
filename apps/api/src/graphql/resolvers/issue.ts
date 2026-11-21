import { db, issue, project, projectColumn, user } from '@repo/db';
import { trustedOrigins } from '@repo/auth';
import { and, eq, getTableColumns, ilike, inArray, isNull, or, type SQL } from 'drizzle-orm';
import type { GraphQLContext } from '../context';
import { paginate, type PageArgs } from '../connection';
import { gqlError } from '../errors';
import { issueFilterSql } from '../issue-filter';
import { toTeam, visibleProjectIds } from './team';
import { toGraphQLUser } from './user';
import { toWorkflowState } from './workflow-state';

// Linear's Issue over the issue table. Fields the app has no data for resolve to
// their neutral value (see schema.ts).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDENTIFIER = /^([A-Za-z0-9]+)-(\d+)$/;

const PRIORITY_LABEL = ['No priority', 'Urgent', 'High', 'Medium', 'Low'];

const issueColumns = { ...getTableColumns(issue), projectKey: project.key };
type IssueRecord = typeof issue.$inferSelect & { projectKey: string };

const issueSelect = () =>
  db.select(issueColumns).from(issue).innerJoin(project, eq(project.id, issue.projectId));

const iso = (d: Date | null) => (d ? d.toISOString() : null);

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function toIssue(row: IssueRecord) {
  const identifier = `${row.projectKey}-${row.sequenceNumber}`;
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
    url: `${trustedOrigins[0]}/project/${row.projectKey}/issue/${row.sequenceNumber}`,
    branchName: `${identifier.toLowerCase()}-${slug(row.title)}`.slice(0, 60).replace(/-+$/, ''),
    trashed: false,
    // Read by the Issue relation resolvers; not schema fields.
    projectId: row.projectId,
    columnId: row.columnId,
    parentId: row.parentId,
    assigneeUserId: row.assigneeUserId,
    delegateUserId: row.delegateUserId,
    creatorUserId: row.creatorUserId,
  };
}

type GraphQLIssue = ReturnType<typeof toIssue>;

// A visible issue by uuid or identifier ("MKT-42", any case), or ENTITY_NOT_FOUND.
export async function findIssue(idOrIdentifier: string, userId: string): Promise<IssueRecord> {
  let match: SQL | undefined;
  if (UUID.test(idOrIdentifier)) match = eq(issue.id, idOrIdentifier);
  else {
    const m = IDENTIFIER.exec(idOrIdentifier);
    if (m)
      match = and(eq(project.key, m[1]!.toUpperCase()), eq(issue.sequenceNumber, Number(m[2])));
  }
  const rows = match
    ? await issueSelect().where(and(match, inArray(issue.projectId, visibleProjectIds(userId))))
    : [];
  if (!rows[0]) throw gqlError('ENTITY_NOT_FOUND', `Issue ${idOrIdentifier} not found`);
  return rows[0];
}

type ConnectionArgs = PageArgs & { filter?: unknown; includeArchived?: boolean | null };

// One page of the viewer's visible issues matching `where`, the filter and
// includeArchived.
export function listIssues(where: SQL | undefined, args: ConnectionArgs, viewerId: string) {
  return paginate(
    args,
    { id: issue.id, createdAt: issue.createdAt, updatedAt: issue.updatedAt },
    and(
      inArray(issue.projectId, visibleProjectIds(viewerId)),
      where,
      args.includeArchived ? undefined : isNull(issue.archivedAt),
      issueFilterSql(args.filter, viewerId),
    ),
    (w, order, limit) =>
      issueSelect()
        .where(w)
        .orderBy(...order)
        .limit(limit),
    (row) => toIssue(row),
  );
}

async function userById(id: string | null, viewerId: string) {
  if (!id) return null;
  const [row] = await db.select().from(user).where(eq(user.id, id));
  return row ? toGraphQLUser(row, viewerId) : null;
}

// Relation fields of an Issue, shared with IssueSearchResult (an issue plus search
// metadata).
const issueRelations = {
  team: async (i: GraphQLIssue) => {
    const [row] = await db.select().from(project).where(eq(project.id, i.projectId));
    return toTeam(row!);
  },
  state: async (i: GraphQLIssue) => {
    const [row] = await db.select().from(projectColumn).where(eq(projectColumn.id, i.columnId));
    return toWorkflowState(row!);
  },
  parent: async (i: GraphQLIssue) => {
    if (!i.parentId) return null;
    const [row] = await issueSelect().where(eq(issue.id, i.parentId));
    return row ? toIssue(row) : null;
  },
  children: (i: GraphQLIssue, args: ConnectionArgs, ctx: GraphQLContext) =>
    listIssues(eq(issue.parentId, i.id), args, ctx.user.id),
  assignee: (i: GraphQLIssue, _: unknown, ctx: GraphQLContext) =>
    userById(i.assigneeUserId, ctx.user.id),
  delegate: (i: GraphQLIssue, _: unknown, ctx: GraphQLContext) =>
    userById(i.delegateUserId, ctx.user.id),
  creator: (i: GraphQLIssue, _: unknown, ctx: GraphQLContext) =>
    userById(i.creatorUserId, ctx.user.id),
};

export const issueResolvers = {
  Query: {
    issue: async (_: unknown, args: { id: string }, ctx: GraphQLContext) =>
      toIssue(await findIssue(args.id, ctx.user.id)),
    issues: (_: unknown, args: ConnectionArgs, ctx: GraphQLContext) =>
      listIssues(undefined, args, ctx.user.id),
    searchIssues: (
      _: unknown,
      args: ConnectionArgs & { term: string; teamId?: string | null },
      ctx: GraphQLContext,
    ) => {
      const pattern = `%${args.term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      return listIssues(
        and(
          or(ilike(issue.title, pattern), ilike(issue.description, pattern)),
          args.teamId && UUID.test(args.teamId) ? eq(issue.projectId, args.teamId) : undefined,
        ),
        args,
        ctx.user.id,
      ).then((page) => ({ ...page, totalCount: page.nodes.length }));
    },
  },
  Issue: issueRelations,
  IssueSearchResult: issueRelations,
  Team: {
    issues: (team: { id: string }, args: ConnectionArgs, ctx: GraphQLContext) =>
      listIssues(eq(issue.projectId, team.id), args, ctx.user.id),
  },
  WorkflowState: {
    issues: (state: { id: string }, args: ConnectionArgs, ctx: GraphQLContext) =>
      listIssues(eq(issue.columnId, state.id), args, ctx.user.id),
  },
  User: {
    assignedIssues: (u: { id: string }, args: ConnectionArgs, ctx: GraphQLContext) =>
      listIssues(eq(issue.assigneeUserId, u.id), args, ctx.user.id),
  },
};
