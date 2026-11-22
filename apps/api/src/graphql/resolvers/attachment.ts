import { attachment, db, issue, teamMember } from '@repo/db';
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import {
  attachmentUrl,
  deleteAttachment,
  getAttachment,
  mapAttachment,
  normalizeAttachmentUrl,
  updateAttachment,
  upsertLinkAttachment,
  type AttachmentRow,
  type LinkInput,
} from '../../attachments/store';
import { assertParentAccess, createComment } from '../../comments/store';
import { getMembership } from '../../members/store';
import { assertPermission, type AuthUser } from '../../shared/access';
import { HttpError, UUID_RE } from '../../shared/lib';
import type { GraphQLContext } from '../context';
import { attachmentFilterSql } from '../attachment-filter';
import { paginate, type PageArgs } from '../connection';
import { gqlError } from '../errors';
import { issueById, userById } from './issue';
import { guard, lastSyncId, onlySupported } from './mutations';

// Linear's Attachment: links and uploaded files on issues. An attachment is visible
// to members of its issue's team; writes need work_items.create / edit / delete
// there, as the REST attachment routes.

export const toAttachment = (row: AttachmentRow) => ({
  ...row,
  url: attachmentUrl(row),
  archivedAt: null,
  source: null,
  bodyData: null,
});

type GraphQLAttachment = ReturnType<typeof toAttachment>;
type ListArgs = PageArgs & { filter?: unknown; includeArchived?: boolean | null };
type Action = 'read' | 'create' | 'edit' | 'delete';

// 404 when the issue is missing or the user is not in its team; 403 without the
// work_items action.
async function assertIssueAccess(issueId: string, user: AuthUser, action: Action): Promise<void> {
  const [row] = await db.select({ teamId: issue.teamId }).from(issue).where(eq(issue.id, issueId));
  if (!row || !(await getMembership(row.teamId, user.id)))
    throw new HttpError(404, 'Issue not found');
  if (action !== 'read') await assertPermission(row.teamId, user, 'work_items', action);
}

// SQL over `attachment`: attachments on issues of the user's teams.
function visibleAttachmentsSql(userId: string): SQL {
  const memberTeams = db
    .select({ id: teamMember.teamId })
    .from(teamMember)
    .where(eq(teamMember.userId, userId));
  return inArray(
    attachment.issueId,
    db.select({ id: issue.id }).from(issue).where(inArray(issue.teamId, memberTeams)),
  );
}

const openOnly = sql`${attachment.issueId} IN (SELECT id FROM issue WHERE archived_at IS NULL)`;

async function listAttachments(where: SQL | undefined, args: ListArgs, ctx: GraphQLContext) {
  return paginate(
    args,
    { id: attachment.id, createdAt: attachment.createdAt, updatedAt: attachment.updatedAt },
    and(
      visibleAttachmentsSql(ctx.user.id),
      where,
      args.includeArchived ? undefined : openOnly,
      attachmentFilterSql(args.filter),
    ),
    (w, order, limit) =>
      db
        .select()
        .from(attachment)
        .where(w)
        .orderBy(...order)
        .limit(limit),
    (row) => toAttachment(mapAttachment(row)),
  );
}

// An attachment the viewer can see, by id or (as Linear allows) by URL, or
// ENTITY_NOT_FOUND.
async function findAttachment(idOrUrl: string, ctx: GraphQLContext): Promise<AttachmentRow> {
  return guard(async () => {
    let found: AttachmentRow | null = null;
    if (UUID_RE.test(idOrUrl)) {
      found = await getAttachment(idOrUrl);
    } else {
      const [row] = await db
        .select()
        .from(attachment)
        .where(
          and(
            eq(attachment.url, normalizeAttachmentUrl(idOrUrl)),
            visibleAttachmentsSql(ctx.user.id),
          ),
        )
        .orderBy(attachment.createdAt)
        .limit(1);
      found = row ? mapAttachment(row) : null;
    }
    if (!found) throw gqlError('ENTITY_NOT_FOUND', `Attachment ${idOrUrl} not found`);
    await assertIssueAccess(found.issueId, ctx.user, 'read');
    return found;
  });
}

function checkId(value: unknown, field: string): void {
  if (value != null && !UUID_RE.test(String(value)))
    throw gqlError('INVALID_INPUT', `${field} is not a valid id`);
}

const payload = (row: AttachmentRow) => ({
  success: true,
  lastSyncId: lastSyncId(),
  attachment: toAttachment(row),
});

type Input = Record<string, unknown>;

// attachmentCreate and attachmentLinkURL: check access (and comment access for
// commentBody) before writing, then upsert by issue and URL.
async function createLink(input: Input, ctx: GraphQLContext, commentBody?: unknown) {
  checkId(input.issueId, 'issueId');
  checkId(input.id, 'id');
  const issueId = String(input.issueId);
  await assertIssueAccess(issueId, ctx.user, 'create');
  if (commentBody) await assertParentAccess({ issueId }, ctx.user, 'create');
  const { row } = await upsertLinkAttachment(
    {
      ...(input as unknown as LinkInput),
      issueId,
      url: String(input.url),
      title: input.title == null ? undefined : String(input.title),
      id: input.id == null ? undefined : String(input.id),
    },
    ctx.user.id,
  );
  if (commentBody)
    await createComment({
      parent: { issueId },
      body: String(commentBody),
      actorUserId: ctx.user.id,
    });
  return payload(row);
}

export const attachmentResolvers = {
  Query: {
    attachment: async (_: unknown, { id }: { id: string }, ctx: GraphQLContext) =>
      toAttachment(await findAttachment(id, ctx)),
    attachments: (_: unknown, args: ListArgs, ctx: GraphQLContext) =>
      listAttachments(undefined, args, ctx),
    attachmentsForURL: (_: unknown, args: ListArgs & { url: string }, ctx: GraphQLContext) =>
      listAttachments(eq(attachment.url, normalizeAttachmentUrl(args.url)), args, ctx),
    attachmentIssue: async (_: unknown, { id }: { id: string }, ctx: GraphQLContext) =>
      issueById((await findAttachment(id, ctx)).issueId),
  },
  Attachment: {
    creator: (a: GraphQLAttachment, _: unknown, ctx: GraphQLContext) =>
      userById(a.creatorUserId, ctx.user.id),
    issue: (a: GraphQLAttachment) => issueById(a.issueId),
    originalIssue: () => null,
    externalUserCreator: () => null,
  },
  Issue: {
    attachments: (i: { id: string }, args: ListArgs, ctx: GraphQLContext) =>
      listAttachments(eq(attachment.issueId, i.id), args, ctx),
  },
  Mutation: {
    attachmentCreate: (_: unknown, { input }: { input: Input }, ctx: GraphQLContext) =>
      guard(async () => {
        onlySupported(
          input,
          [
            'issueId',
            'title',
            'url',
            'subtitle',
            'iconUrl',
            'metadata',
            'groupBySource',
            'commentBody',
            'id',
          ],
          'input',
        );
        const { commentBody, ...rest } = input;
        return createLink(rest, ctx, commentBody);
      }),
    attachmentLinkURL: (_: unknown, args: Input, ctx: GraphQLContext) =>
      guard(async () => {
        onlySupported(args, ['issueId', 'url', 'title', 'id'], 'argument');
        return createLink(args, ctx);
      }),
    attachmentUpdate: (
      _: unknown,
      { id, input }: { id: string; input: Input },
      ctx: GraphQLContext,
    ) =>
      guard(async () => {
        onlySupported(input, ['title', 'subtitle', 'iconUrl', 'metadata'], 'input');
        const found = await findAttachment(id, ctx);
        await assertIssueAccess(found.issueId, ctx.user, 'edit');
        const updated = await updateAttachment(
          found.id,
          input as Parameters<typeof updateAttachment>[1],
          ctx.user.id,
        );
        return payload(updated!);
      }),
    attachmentDelete: (_: unknown, { id }: { id: string }, ctx: GraphQLContext) =>
      guard(async () => {
        const found = await findAttachment(id, ctx);
        await assertIssueAccess(found.issueId, ctx.user, 'delete');
        await deleteAttachment(found.id, ctx.user.id);
        return { success: true, lastSyncId: lastSyncId(), entityId: found.id };
      }),
  },
};
