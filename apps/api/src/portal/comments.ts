import { comment, db, externalUser, issue, portalBoard, team, user } from '@repo/db';
import { trustedOrigins } from '@repo/auth';
import { and, asc, eq, sql } from 'drizzle-orm';
import {
  createComment,
  deleteVisitorComment,
  getComment,
  updateVisitorComment,
  type CommentRow,
} from '../comments/store';
import { HttpError, iso, UUID_RE } from '../shared/lib';
import type { BoardRow } from './boards';
import { boardCommentsSql, visitorMayReadIssue } from './issues';
import { allow, LIMITS } from './rate-limit';
import type { Visitor } from './session';

// Comments on the portal. A visitor's comment is a Linear comment with the visitor's
// requester as `external_user_id` and no user. A root comment written on a board (by a
// visitor, or by a member through "Post on portal") starts a portal thread that
// belongs to that board (`portal_board_id`); replies belong to their root's thread.
// Which comments a board shows is `boardCommentsSql`.

export const MAX_COMMENT_BODY = 10_000;

export interface PortalComment {
  id: string;
  parentId: string | null;
  body: string;
  createdAt: string;
  editedAt: string | null;
  author: { name: string; avatarUrl: string | null; team: boolean };
  mine: boolean;
}

function commentBody(value: unknown): string {
  const body = typeof value === 'string' ? value.trim() : '';
  if (!body) throw new HttpError(400, 'body is required');
  if (body.length > MAX_COMMENT_BODY)
    throw new HttpError(400, `A comment is at most ${MAX_COMMENT_BODY} characters`);
  return body;
}

// The comments the board shows on the issue, oldest first. A comment with neither a
// member nor a visitor author was written by a workflow automation.
export async function listPortalComments(
  board: BoardRow,
  issueId: string,
  visitor: Visitor | null,
): Promise<PortalComment[]> {
  const rows = await db
    .select({
      id: comment.id,
      parentId: comment.parentId,
      body: comment.body,
      createdAt: comment.createdAt,
      editedAt: comment.editedAt,
      userId: comment.userId,
      memberName: sql<string | null>`nullif(trim(${user.name}), '')`,
      memberAvatar: user.image,
      externalUserId: comment.externalUserId,
      visitorName: externalUser.displayName,
      visitorAvatar: externalUser.avatarUrl,
    })
    .from(comment)
    .leftJoin(user, eq(user.id, comment.userId))
    .leftJoin(externalUser, eq(externalUser.id, comment.externalUserId))
    .where(and(eq(comment.issueId, issueId), boardCommentsSql(board)))
    .orderBy(asc(comment.createdAt), asc(comment.id));
  return rows.map((r) => {
    let author: PortalComment['author'];
    if (r.externalUserId)
      author = { name: r.visitorName ?? 'Portal visitor', avatarUrl: r.visitorAvatar, team: false };
    // A member without a name shows as "Team" (never a part of their email).
    else if (r.userId)
      author = { name: r.memberName ?? 'Team', avatarUrl: r.memberAvatar, team: true };
    else author = { name: 'Automation', avatarUrl: null, team: true };
    return {
      id: r.id,
      parentId: r.parentId,
      body: r.body,
      createdAt: iso(r.createdAt),
      editedAt: r.editedAt ? iso(r.editedAt) : null,
      author,
      mine: !!visitor && r.externalUserId === visitor.requesterId,
    };
  });
}

// The comment `id` when the board shows it on one of its issues' comment lists; 404
// otherwise.
async function boardComment(board: BoardRow, id: string): Promise<CommentRow> {
  const [row] = UUID_RE.test(id)
    ? await db
        .select({ id: comment.id })
        .from(comment)
        .where(and(eq(comment.id, id), boardCommentsSql(board)))
    : [];
  const found = row ? await getComment(row.id) : null;
  if (!found?.issueId) throw new HttpError(404, 'Comment not found');
  return found;
}

// A comment the board shows on an issue the visitor may still read there; 404 otherwise.
async function readableComment(board: BoardRow, id: string, visitor: Visitor): Promise<CommentRow> {
  const found = await boardComment(board, id);
  if (!(await visitorMayReadIssue(board, visitor, found.issueId!)))
    throw new HttpError(404, 'Comment not found');
  return found;
}

async function portalComment(
  board: BoardRow,
  issueId: string,
  id: string,
  visitor: Visitor,
): Promise<PortalComment> {
  const found = (await listPortalComments(board, issueId, visitor)).find((c) => c.id === id);
  if (!found) throw new HttpError(404, 'Comment not found');
  return found;
}

// A visitor's comment on an issue the board shows (the caller checked that). A reply
// goes only into a thread the board shows (404 otherwise); a root starts a thread of
// this board.
export async function createPortalComment(
  board: BoardRow,
  issueId: string,
  visitor: Visitor,
  input: Record<string, unknown>,
): Promise<PortalComment> {
  const body = commentBody(input.body);
  let parentId: string | null = null;
  if (input.parentId !== undefined && input.parentId !== null) {
    const replyTo = await boardComment(board, String(input.parentId));
    if (replyTo.issueId !== issueId) throw new HttpError(404, 'Comment not found');
    parentId = replyTo.id;
  }
  const { limit, windowMs } = LIMITS.comments;
  if (!allow(`comment:${visitor.requesterId}`, limit, windowMs))
    throw new HttpError(429, 'Too many comments, try again later');
  const created = await createComment({
    parent: { issueId },
    parentId,
    body,
    actorUserId: null,
    externalUserId: visitor.requesterId,
    portalBoardId: board.id,
  });
  return portalComment(board, issueId, created.id, visitor);
}

export async function editPortalComment(
  board: BoardRow,
  id: string,
  visitor: Visitor,
  input: Record<string, unknown>,
): Promise<PortalComment> {
  const found = await readableComment(board, id, visitor);
  const updated = await updateVisitorComment(
    found.id,
    commentBody(input.body),
    visitor.requesterId,
  );
  return portalComment(board, updated.issueId!, updated.id, visitor);
}

export async function deletePortalComment(
  board: BoardRow,
  id: string,
  visitor: Visitor,
): Promise<void> {
  const found = await readableComment(board, id, visitor);
  await deleteVisitorComment(found.id, visitor.requesterId);
}

// A member starts a portal thread on a board showing the issue with portal threads
// (400 otherwise). The caller checked the member may comment on the issue.
export async function startPortalThread(
  board: BoardRow,
  issueId: string,
  actorUserId: string,
  bodyValue: unknown,
  shown: boolean,
): Promise<CommentRow> {
  if (!shown || board.comments !== 'portal')
    throw new HttpError(400, 'This board does not show portal threads on this issue');
  return createComment({
    parent: { issueId },
    body: commentBody(bodyValue),
    actorUserId,
    portalBoardId: board.id,
  });
}

// Linear's SyncedExternalThread for a portal thread's root comment: the board's name
// and the issue's page on it. Null when the board was deleted.
export async function portalThread(boardId: string, issueId: string | null) {
  const [board] = await db
    .select({ name: portalBoard.name, slug: portalBoard.slug })
    .from(portalBoard)
    .where(eq(portalBoard.id, boardId));
  if (!board) return null;
  const [row] = issueId
    ? await db
        .select({ key: team.key, number: issue.sequenceNumber })
        .from(issue)
        .innerJoin(team, eq(team.id, issue.teamId))
        .where(eq(issue.id, issueId))
    : [];
  const page = row ? `/${row.key}-${row.number}` : '';
  return {
    id: boardId,
    type: 'portal',
    subType: null,
    name: board.name,
    displayName: board.name,
    url: `${trustedOrigins[0] ?? ''}/portal/${board.slug}${page}`,
    isConnected: true,
    isPersonalIntegrationConnected: false,
    isPersonalIntegrationRequired: false,
  };
}
