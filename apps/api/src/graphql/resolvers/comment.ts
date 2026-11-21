import { comment, db } from '@repo/db';
import { and, eq, type SQL } from 'drizzle-orm';
import {
  assertParentAccess,
  commentParent,
  commentParentUrl,
  createComment,
  deleteComment,
  getComment,
  mapComment,
  readableCommentsSql,
  resolveComment,
  unresolveComment,
  updateComment,
  type CommentParent,
  type CommentRow,
} from '../../comments/store';
import { HttpError, UUID_RE } from '../../shared/lib';
import type { GraphQLContext } from '../context';
import { paginate, type PageArgs } from '../connection';
import { commentFilterSql } from '../comment-filter';
import { gqlError } from '../errors';
import { issueById, userById } from './issue';
import { guard, lastSyncId, onlySupported } from './mutations';
import { findProject } from './project';

// Linear's Comment over a comment row. `parentUrl` is the web URL of the comment's
// issue, project or project update; GraphQL resolves `url` lazily when it is empty.
export function toComment(row: CommentRow, parentUrl = '') {
  return {
    id: row.id,
    body: row.body,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: null,
    editedAt: row.editedAt,
    resolvedAt: row.resolvedAt,
    issueId: row.issueId,
    projectId: row.projectId,
    projectUpdateId: row.projectUpdateId,
    parentId: row.parentId,
    userId: row.userId,
    resolvingUserId: row.resolvingUserId,
    resolvingCommentId: row.resolvingCommentId,
    url: parentUrl ? `${parentUrl}#comment-${row.id}` : '',
  };
}

type GraphQLComment = ReturnType<typeof toComment>;
type ConnectionArgs = PageArgs & { filter?: unknown };

// One page of the comments the viewer can read, narrowed by `where` and the filter.
async function listComments(where: SQL | undefined, args: ConnectionArgs, ctx: GraphQLContext) {
  return paginate(
    args,
    { id: comment.id, createdAt: comment.createdAt, updatedAt: comment.updatedAt },
    and(await readableCommentsSql(ctx.user.id), where, commentFilterSql(args.filter)),
    (w, order, limit) =>
      db
        .select()
        .from(comment)
        .where(w)
        .orderBy(...order)
        .limit(limit),
    (row) => toComment(mapComment(row)),
  );
}

// A comment the viewer can read, or ENTITY_NOT_FOUND.
async function readableComment(id: string, ctx: GraphQLContext): Promise<CommentRow> {
  const found = UUID_RE.test(id) ? await getComment(id) : null;
  if (found) {
    try {
      await assertParentAccess(commentParent(found), ctx.user, 'read');
      return found;
    } catch (err) {
      if (!(err instanceof HttpError)) throw err;
    }
  }
  throw gqlError('ENTITY_NOT_FOUND', `Comment ${id} not found`);
}

const payload = (row: CommentRow) => ({
  success: true,
  lastSyncId: lastSyncId(),
  comment: toComment(row),
});

type CreateInput = Record<string, unknown> & {
  body: string;
  issueId?: string | null;
  projectId?: string | null;
  projectUpdateId?: string | null;
  parentId?: string | null;
  id?: string | null;
};

function parentOf(input: CreateInput): CommentParent {
  const given = [
    input.issueId && { issueId: input.issueId },
    input.projectId && { projectId: input.projectId },
    input.projectUpdateId && { projectUpdateId: input.projectUpdateId },
  ].filter(Boolean) as CommentParent[];
  if (given.length !== 1)
    throw gqlError(
      'INVALID_INPUT',
      'Set exactly one of input.issueId, input.projectId, input.projectUpdateId',
    );
  for (const v of [input.issueId, input.projectId, input.projectUpdateId, input.parentId, input.id])
    if (v && !UUID_RE.test(v)) throw gqlError('INVALID_INPUT', `${v} is not a valid id`);
  return given[0]!;
}

export const commentResolvers = {
  Query: {
    comment: (_: unknown, { id }: { id?: string }, ctx: GraphQLContext) =>
      guard(async () => toComment(await readableComment(id ?? '', ctx))),
    comments: (_: unknown, args: ConnectionArgs, ctx: GraphQLContext) =>
      listComments(undefined, args, ctx),
  },
  Issue: {
    comments: (i: { id: string }, args: ConnectionArgs, ctx: GraphQLContext) =>
      listComments(eq(comment.issueId, i.id), args, ctx),
  },
  Project: {
    comments: (p: { id: string }, args: ConnectionArgs, ctx: GraphQLContext) =>
      listComments(eq(comment.projectId, p.id), args, ctx),
  },
  ProjectUpdate: {
    comments: (u: { id: string }, args: ConnectionArgs, ctx: GraphQLContext) =>
      listComments(eq(comment.projectUpdateId, u.id), args, ctx),
  },
  Comment: {
    url: async (c: GraphQLComment) => {
      if (c.url) return c.url;
      const row = await getComment(c.id);
      return row ? `${await commentParentUrl(row)}#comment-${c.id}` : '';
    },
    children: (c: GraphQLComment, args: ConnectionArgs, ctx: GraphQLContext) =>
      listComments(eq(comment.parentId, c.id), args, ctx),
    parent: async (c: GraphQLComment) => {
      if (!c.parentId) return null;
      const row = await getComment(c.parentId);
      return row ? toComment(row) : null;
    },
    resolvingComment: async (c: GraphQLComment) => {
      if (!c.resolvingCommentId) return null;
      const row = await getComment(c.resolvingCommentId);
      return row ? toComment(row) : null;
    },
    user: (c: GraphQLComment, _: unknown, ctx: GraphQLContext) => userById(c.userId, ctx.user.id),
    resolvingUser: (c: GraphQLComment, _: unknown, ctx: GraphQLContext) =>
      userById(c.resolvingUserId, ctx.user.id),
    issue: (c: GraphQLComment) => (c.issueId ? issueById(c.issueId) : null),
    project: (c: GraphQLComment, _: unknown, ctx: GraphQLContext) =>
      c.projectId ? findProject(c.projectId, ctx) : null,
  },
  Mutation: {
    commentCreate: (_: unknown, { input }: { input: CreateInput }, ctx: GraphQLContext) =>
      guard(async () => {
        onlySupported(
          input,
          ['body', 'issueId', 'projectId', 'projectUpdateId', 'parentId', 'id'],
          'input',
        );
        if (!input.body) throw gqlError('INVALID_INPUT', 'input.body is required');
        const parent = parentOf(input);
        await assertParentAccess(parent, ctx.user, 'create');
        const created = await createComment({
          parent,
          parentId: input.parentId,
          body: input.body,
          actorUserId: ctx.user.id,
          id: input.id ?? undefined,
        });
        return payload(created);
      }),
    commentUpdate: (
      _: unknown,
      { id, input }: { id: string; input: Record<string, unknown> & { body?: string } },
      ctx: GraphQLContext,
    ) =>
      guard(async () => {
        onlySupported(input, ['body'], 'input');
        if (!input.body) throw gqlError('INVALID_INPUT', 'input.body is required');
        await readableComment(id, ctx);
        return payload(await updateComment(id, input.body, ctx.user.id));
      }),
    commentDelete: (_: unknown, { id }: { id: string }, ctx: GraphQLContext) =>
      guard(async () => {
        await readableComment(id, ctx);
        await deleteComment(id, ctx.user.id);
        return { success: true, lastSyncId: lastSyncId(), entityId: id };
      }),
    commentResolve: (
      _: unknown,
      { id, resolvingCommentId }: { id: string; resolvingCommentId?: string | null },
      ctx: GraphQLContext,
    ) =>
      guard(async () => {
        await readableComment(id, ctx);
        return payload(await resolveComment(id, ctx.user.id, resolvingCommentId));
      }),
    commentUnresolve: (_: unknown, { id }: { id: string }, ctx: GraphQLContext) =>
      guard(async () => {
        await readableComment(id, ctx);
        return payload(await unresolveComment(id, ctx.user.id));
      }),
  },
};
