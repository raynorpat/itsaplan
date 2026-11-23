import { APP_ROLE } from '@repo/auth';
import { agentActivity, agentSession, db, user as userTable } from '@repo/db';
import { and, eq, inArray, type SQL } from 'drizzle-orm';
import {
  addActivity,
  agentActivityInput,
  assertSessionThread,
  getSession,
  nextExternalUrls,
  planInput,
  readableSessionsSql,
  startSession,
  updateSession,
  type ActivityRow,
  type ExternalUrl,
  type SessionRow,
} from '../../agents/store';
import { assertParentAccess, commentParent, getComment } from '../../comments/store';
import { assertTeamAccess } from '../../shared/access';
import { HttpError, UUID_RE } from '../../shared/lib';
import type { GraphQLContext } from '../context';
import { paginate, type PageArgs } from '../connection';
import { gqlError } from '../errors';
import { compare, compareId, filterSql, refFilter, type FieldHandlers } from '../filter';
import { loaders } from '../loaders';
import { toComment } from './comment';
import { findIssue, issueById, userFor } from './issue';
import { guard, lastSyncId, onlySupported } from './mutations';
import { toGraphQLUser } from './user';

// Linear's agent API: AgentSession and AgentActivity reads, and the mutations an
// installed agent app uses (agentSessionCreateOnIssue / OnComment, agentActivityCreate,
// agentSessionUpdate, agentSessionUpdateExternalUrl). Rules are in agents/store.ts.

const CONTENT_TYPENAME: Record<string, string> = {
  thought: 'AgentActivityThoughtContent',
  action: 'AgentActivityActionContent',
  elicitation: 'AgentActivityElicitationContent',
  response: 'AgentActivityResponseContent',
  error: 'AgentActivityErrorContent',
  prompt: 'AgentActivityPromptContent',
};

function toSession(row: SessionRow) {
  const links = row.externalUrls as ExternalUrl[];
  return {
    id: row.id,
    slugId: row.slugId,
    status: row.status,
    summary: row.summary,
    plan: row.plan,
    externalLink: row.externalLink,
    externalLinks: links,
    // Linear's deprecated externalUrls is the same list as a JSON-encoded string.
    externalUrls: JSON.stringify(links),
    context: [],
    sourceMetadata: null,
    type: 'commentThread',
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    endedAt: row.endedAt?.toISOString() ?? null,
    dismissedAt: row.dismissedAt?.toISOString() ?? null,
    archivedAt: null,
    // Read by the relation resolvers; not schema fields.
    issueId: row.issueId,
    commentId: row.commentId,
    sourceCommentId: row.sourceCommentId,
    appUserId: row.appUserId,
    creatorUserId: row.creatorUserId,
    dismissedByUserId: row.dismissedByUserId,
  };
}

type GraphQLSession = ReturnType<typeof toSession>;

function toActivity(row: ActivityRow) {
  return {
    id: row.id,
    content: row.content,
    ephemeral: row.ephemeral,
    signal: row.signal,
    signalMetadata: row.signalMetadata,
    sourceMetadata: null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    archivedAt: null,
    // Read by the relation resolvers; not schema fields.
    type: row.type,
    sessionId: row.sessionId,
    userId: row.userId,
    sourceCommentId: row.sourceCommentId,
  };
}

type GraphQLActivity = ReturnType<typeof toActivity>;
type ConnectionArgs = PageArgs & { filter?: unknown };

// A user by id without the visibility check: the app user or author of something the
// viewer may already read. Through the request's loader, so a list of activities makes
// one query for its users.
async function userRow(id: string, ctx: GraphQLContext) {
  const row = await loaders(ctx).anyUser.load(id);
  return row ? toGraphQLUser(row, ctx.user.id) : null;
}

// A comment by id when the viewer can read it, else null.
async function readableCommentOrNull(id: string | null, ctx: GraphQLContext) {
  if (!id) return null;
  const found = await getComment(id);
  if (!found) return null;
  try {
    await assertParentAccess(commentParent(found), ctx.user);
  } catch (err) {
    if (err instanceof HttpError) return null;
    throw err;
  }
  return toComment(found);
}

// A session the viewer may read, by uuid or slug, or ENTITY_NOT_FOUND.
async function readableSession(id: string, ctx: GraphQLContext): Promise<SessionRow> {
  const match = UUID_RE.test(id) ? eq(agentSession.id, id) : eq(agentSession.slugId, id);
  const [row] = await db
    .select()
    .from(agentSession)
    .where(and(match, await readableSessionsSql(ctx.user.id)));
  if (!row) throw gqlError('ENTITY_NOT_FOUND', `Agent session ${id} not found`);
  return row;
}

async function isApp(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ role: userTable.workspaceRole })
    .from(userTable)
    .where(eq(userTable.id, userId));
  return row?.role === APP_ROLE;
}

// Only an installed agent app (its app user) starts sessions and publishes activities.
async function assertAgent(ctx: GraphQLContext): Promise<void> {
  if (!(await isApp(ctx.user.id)))
    throw gqlError('FORBIDDEN', 'Only an agent app can do this; use its app token');
}

// AgentActivityFilter fields this API supports.
const activityFilter: FieldHandlers = {
  id: (v, p) => compareId(agentActivity.id, v, p),
  agentSessionId: (v, p) => compare(agentActivity.sessionId, v, p),
  type: (v, p) => compare(agentActivity.type, v, p),
  createdAt: (v, p) => compare(agentActivity.createdAt, v, p),
  updatedAt: (v, p) => compare(agentActivity.updatedAt, v, p),
  sourceComment: (v, p) => refFilter(agentActivity.sourceCommentId, v, p),
};

function listSessions(where: SQL | undefined, args: ConnectionArgs) {
  return paginate(
    args,
    { id: agentSession.id, createdAt: agentSession.createdAt, updatedAt: agentSession.updatedAt },
    where,
    (w, order, limit) =>
      db
        .select()
        .from(agentSession)
        .where(w)
        .orderBy(...order)
        .limit(limit),
    toSession,
  );
}

async function listActivities(where: SQL | undefined, args: ConnectionArgs, ctx: GraphQLContext) {
  const readable = inArray(
    agentActivity.sessionId,
    db
      .select({ id: agentSession.id })
      .from(agentSession)
      .where(await readableSessionsSql(ctx.user.id)),
  );
  return paginate(
    args,
    {
      id: agentActivity.id,
      createdAt: agentActivity.createdAt,
      updatedAt: agentActivity.updatedAt,
    },
    and(readable, where, filterSql(args.filter, activityFilter)),
    (w, order, limit) =>
      db
        .select()
        .from(agentActivity)
        .where(w)
        .orderBy(...order)
        .limit(limit),
    toActivity,
  );
}

const sessionPayload = async (id: string) => ({
  success: true,
  lastSyncId: lastSyncId(),
  agentSession: toSession((await getSession(id))!),
});

type UpdateInput = Record<string, unknown> & {
  summary?: string | null;
  plan?: unknown;
  externalLink?: string | null;
  externalUrls?: unknown;
  addedExternalUrls?: unknown;
  removedExternalUrls?: unknown;
};

const URL_FIELDS = ['externalLink', 'externalUrls', 'addedExternalUrls', 'removedExternalUrls'];

// A session title: 1 to 255 characters with a non-whitespace one, no line breaks or NUL.
function summaryInput(value: string | null): string | null {
  if (value === null) return null;
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 255 ||
    !value.trim() ||
    /[\r\n\0]/.test(value)
  )
    throw gqlError(
      'INVALID_INPUT',
      'input.summary must be 1 to 255 characters on one line, not only spaces',
    );
  return value;
}

export const agentResolvers = {
  Query: {
    agentSession: (_: unknown, { id }: { id: string }, ctx: GraphQLContext) =>
      readableSession(id, ctx).then(toSession),
    agentSessions: async (_: unknown, args: ConnectionArgs, ctx: GraphQLContext) =>
      listSessions(await readableSessionsSql(ctx.user.id), args),
    agentActivity: async (_: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
      const page = UUID_RE.test(id)
        ? await listActivities(eq(agentActivity.id, id), { first: 1 }, ctx)
        : null;
      const found = page?.nodes[0];
      if (!found) throw gqlError('ENTITY_NOT_FOUND', `Agent activity ${id} not found`);
      return found;
    },
    agentActivities: (_: unknown, args: ConnectionArgs, ctx: GraphQLContext) =>
      listActivities(undefined, args, ctx),
  },

  AgentSession: {
    appUser: (s: GraphQLSession, _: unknown, ctx: GraphQLContext) => userRow(s.appUserId, ctx),
    creator: (s: GraphQLSession, _: unknown, ctx: GraphQLContext) => userFor(ctx, s.creatorUserId),
    dismissedBy: (s: GraphQLSession, _: unknown, ctx: GraphQLContext) =>
      userFor(ctx, s.dismissedByUserId),
    issue: (s: GraphQLSession) => issueById(s.issueId),
    comment: (s: GraphQLSession, _: unknown, ctx: GraphQLContext) =>
      readableCommentOrNull(s.commentId, ctx),
    sourceComment: (s: GraphQLSession, _: unknown, ctx: GraphQLContext) =>
      readableCommentOrNull(s.sourceCommentId, ctx),
    url: async (s: GraphQLSession) => (await issueById(s.issueId))?.url ?? null,
    activities: (s: GraphQLSession, args: ConnectionArgs, ctx: GraphQLContext) =>
      listActivities(eq(agentActivity.sessionId, s.id), args, ctx),
  },

  AgentActivity: {
    agentSession: async (a: GraphQLActivity) => toSession((await getSession(a.sessionId))!),
    user: (a: GraphQLActivity, _: unknown, ctx: GraphQLContext) => userRow(a.userId, ctx),
    promptAuthor: (a: GraphQLActivity, _: unknown, ctx: GraphQLContext) =>
      a.type === 'prompt' ? userFor(ctx, a.userId) : null,
    sourceComment: (a: GraphQLActivity, _: unknown, ctx: GraphQLContext) =>
      readableCommentOrNull(a.sourceCommentId, ctx),
  },

  AgentActivityContent: {
    __resolveType: (c: { type: string }) => CONTENT_TYPENAME[c.type] ?? null,
  },

  Comment: {
    agentSession: async (c: { id: string }, _: unknown, ctx: GraphQLContext) => {
      const row = await loaders(ctx).sessionOfComment.load(c.id);
      return row ? toSession(row) : null;
    },
  },

  Mutation: {
    agentSessionCreateOnIssue: (
      _: unknown,
      { input }: { input: Record<string, unknown> & { issueId: string } },
      ctx: GraphQLContext,
    ) =>
      guard(async () => {
        onlySupported(input, ['issueId', 'externalLink', 'externalUrls'], 'input');
        await assertAgent(ctx);
        const found = await findIssue(input.issueId, ctx.user.id);
        await assertTeamAccess(found.teamId, ctx.user, 'see');
        const links = await nextExternalUrls(
          [],
          {
            externalUrls: input.externalUrls,
            externalLink: input.externalLink as string | undefined,
          },
          ctx.user.id,
        );
        const created = await startSession({
          issueId: found.id,
          appUserId: ctx.user.id,
          creatorUserId: null,
          status: 'active',
          externalLink: links.externalLink ?? null,
          externalUrls: links.urls,
        });
        if (!created) throw gqlError('CONFLICT', 'The comment already has an agent session');
        return sessionPayload(created.id);
      }),

    agentSessionCreateOnComment: (
      _: unknown,
      { input }: { input: Record<string, unknown> & { commentId: string } },
      ctx: GraphQLContext,
    ) =>
      guard(async () => {
        onlySupported(input, ['commentId', 'externalLink', 'externalUrls'], 'input');
        await assertAgent(ctx);
        const found = UUID_RE.test(input.commentId) ? await getComment(input.commentId) : null;
        if (!found || !(await readableCommentOrNull(found.id, ctx)))
          throw gqlError('ENTITY_NOT_FOUND', `Comment ${input.commentId} not found`);
        await assertSessionThread(found);
        const links = await nextExternalUrls(
          [],
          {
            externalUrls: input.externalUrls,
            externalLink: input.externalLink as string | undefined,
          },
          ctx.user.id,
        );
        const created = await startSession({
          issueId: found.issueId!,
          appUserId: ctx.user.id,
          creatorUserId: null,
          status: 'active',
          commentId: found.id,
          externalLink: links.externalLink ?? null,
          externalUrls: links.urls,
        });
        if (!created) throw gqlError('CONFLICT', 'The comment already has an agent session');
        return sessionPayload(created.id);
      }),

    agentActivityCreate: (
      _: unknown,
      {
        input,
      }: {
        input: Record<string, unknown> & {
          agentSessionId: string;
          content: Record<string, unknown>;
          signal?: string | null;
          signalMetadata?: Record<string, unknown> | null;
          ephemeral?: boolean | null;
          id?: string | null;
        };
      },
      ctx: GraphQLContext,
    ) =>
      guard(async () => {
        onlySupported(
          input,
          [
            'agentSessionId',
            'content',
            'signal',
            'signalMetadata',
            'ephemeral',
            'id',
            'contextualMetadata',
          ],
          'input',
        );
        await assertAgent(ctx);
        if (input.id != null && !UUID_RE.test(input.id))
          throw gqlError('INVALID_INPUT', 'input.id must be a UUID');
        const session = await readableSession(input.agentSessionId, ctx);
        const parsed = agentActivityInput({
          content: JSON.parse(JSON.stringify(input.content ?? {})),
          signal: input.signal,
          signalMetadata: input.signalMetadata
            ? JSON.parse(JSON.stringify(input.signalMetadata))
            : null,
          ephemeral: input.ephemeral,
        });
        const row = await addActivity({
          session,
          userId: ctx.user.id,
          ...parsed,
          id: input.id ?? undefined,
        });
        return { success: true, lastSyncId: lastSyncId(), agentActivity: toActivity(row) };
      }),

    agentSessionUpdate: (
      _: unknown,
      { id, input }: { id: string; input: UpdateInput },
      ctx: GraphQLContext,
    ) =>
      guard(async () => {
        onlySupported(input, ['summary', 'plan', ...URL_FIELDS], 'input');
        const session = await readableSession(id, ctx);
        const owner = session.appUserId === ctx.user.id;
        const set: Partial<typeof agentSession.$inferInsert> = {};
        const appOnly = Object.keys(input).some((k) => k !== 'summary' && input[k] !== undefined);
        if (appOnly && !owner)
          throw gqlError('FORBIDDEN', "Only the session's agent app can change its plan or links");
        if (input.summary !== undefined) {
          if (!owner && session.creatorUserId !== ctx.user.id)
            throw gqlError(
              'FORBIDDEN',
              "Only the session's agent app or its creator can change its title",
            );
          set.summary = summaryInput(input.summary);
        }
        if (input.plan !== undefined && session.status !== 'error')
          set.plan =
            input.plan === null
              ? null
              : planInput(JSON.parse(JSON.stringify(input.plan)), new Date());
        if (URL_FIELDS.some((k) => input[k] !== undefined)) {
          const links = await nextExternalUrls(
            session.externalUrls as ExternalUrl[],
            JSON.parse(JSON.stringify(input)),
            session.appUserId,
          );
          set.externalUrls = links.urls;
          if (links.externalLink !== undefined) set.externalLink = links.externalLink;
        }
        await updateSession(session, set, appOnly);
        return sessionPayload(session.id);
      }),

    agentSessionUpdateExternalUrl: (
      _: unknown,
      { id, input }: { id: string; input: UpdateInput },
      ctx: GraphQLContext,
    ) =>
      guard(async () => {
        onlySupported(input, URL_FIELDS, 'input');
        const session = await readableSession(id, ctx);
        if (session.appUserId !== ctx.user.id)
          throw gqlError('FORBIDDEN', "Only the session's agent app can change its links");
        const links = await nextExternalUrls(
          session.externalUrls as ExternalUrl[],
          JSON.parse(JSON.stringify(input)),
          session.appUserId,
        );
        await updateSession(
          session,
          {
            externalUrls: links.urls,
            ...(links.externalLink !== undefined ? { externalLink: links.externalLink } : {}),
          },
          true,
        );
        return sessionPayload(session.id);
      }),
  },
};
