import { comment, db, issue, projectTeam, projectUpdate, team, user } from '@repo/db';
import { trustedOrigins } from '@repo/auth';
import { eq } from 'drizzle-orm';
import { HttpError, iso } from '../shared/lib';
import type { FeedItemRow } from '../issues/activity';
import { emitEvent } from '../webhooks/event';
import { commentData } from '../webhooks/data';
import { enqueueMentionRuns } from '../issues/activity';
import { notifyComment } from '../notifications/store';

// Comments (Linear's Comment) on an issue, a project or a project update. A reply
// belongs to the thread of a root comment: replying to a reply stores the new
// comment under that reply's root, so threads are one level deep (Linear).

export type CommentParent =
  { issueId: string } | { projectId: string } | { projectUpdateId: string };

export interface CommentRow {
  id: string;
  issueId: string | null;
  projectId: string | null;
  projectUpdateId: string | null;
  parentId: string | null;
  userId: string | null;
  userName: string | null;
  body: string;
  editedAt: string | null;
  resolvedAt: string | null;
  resolvingUserId: string | null;
  resolvingCommentId: string | null;
  createdAt: string;
  updatedAt: string;
}

export function mapComment(row: typeof comment.$inferSelect): CommentRow {
  return {
    id: row.id,
    issueId: row.issueId,
    projectId: row.projectId,
    projectUpdateId: row.projectUpdateId,
    parentId: row.parentId,
    userId: row.userId,
    userName: row.userName,
    body: row.body,
    editedAt: row.editedAt ? iso(row.editedAt) : null,
    resolvedAt: row.resolvedAt ? iso(row.resolvedAt) : null,
    resolvingUserId: row.resolvingUserId,
    resolvingCommentId: row.resolvingCommentId,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

// An issue comment as an entry of the issue feed (the REST comment route's DTO).
export function commentFeedItem(c: CommentRow): FeedItemRow {
  return {
    id: c.id,
    issueId: c.issueId as string,
    kind: 'comment',
    actorUserId: c.userId,
    actorName: c.userName,
    body: c.body,
    action: null,
    subject: null,
    fromText: null,
    toText: null,
    parentId: c.parentId,
    editedAt: c.editedAt,
    createdAt: c.createdAt,
  };
}

export async function getComment(id: string): Promise<CommentRow | null> {
  const [row] = await db.select().from(comment).where(eq(comment.id, id));
  return row ? mapComment(row) : null;
}

// The web URL of the issue, project or project update a comment is on.
export async function commentParentUrl(c: CommentRow): Promise<string> {
  if (c.issueId) {
    const [row] = await db
      .select({ key: team.key, seq: issue.sequenceNumber })
      .from(issue)
      .innerJoin(team, eq(team.id, issue.teamId))
      .where(eq(issue.id, c.issueId));
    return row ? `${trustedOrigins[0]}/team/${row.key}/issue/${row.seq}` : trustedOrigins[0]!;
  }
  let projectId = c.projectId;
  if (!projectId && c.projectUpdateId) {
    const [row] = await db
      .select({ projectId: projectUpdate.projectId })
      .from(projectUpdate)
      .where(eq(projectUpdate.id, c.projectUpdateId));
    projectId = row?.projectId ?? null;
  }
  return `${trustedOrigins[0]}/projects/${projectId ?? ''}`;
}

const sameParent = (a: CommentParent, b: CommentRow) =>
  ('issueId' in a && a.issueId === b.issueId) ||
  ('projectId' in a && a.projectId === b.projectId) ||
  ('projectUpdateId' in a && a.projectUpdateId === b.projectUpdateId);

// The teams a comment belongs to: its issue's team, or its project's (or its
// project update's project's) teams.
export async function commentTeamIds(c: CommentRow): Promise<string[]> {
  if (c.issueId) {
    const [row] = await db
      .select({ teamId: issue.teamId })
      .from(issue)
      .where(eq(issue.id, c.issueId));
    return row ? [row.teamId] : [];
  }
  let projectId = c.projectId;
  if (!projectId && c.projectUpdateId) {
    const [row] = await db
      .select({ projectId: projectUpdate.projectId })
      .from(projectUpdate)
      .where(eq(projectUpdate.id, c.projectUpdateId));
    projectId = row?.projectId ?? null;
  }
  if (!projectId) return [];
  const rows = await db
    .select({ teamId: projectTeam.teamId })
    .from(projectTeam)
    .where(eq(projectTeam.projectId, projectId));
  return rows.map((r) => r.teamId);
}

async function userName(id: string | null): Promise<string | null> {
  if (!id) return null;
  const [row] = await db.select({ name: user.name }).from(user).where(eq(user.id, id));
  return row?.name ?? null;
}

// Creates a comment. parentId names the comment being replied to; it must be on the
// same parent entity (400 otherwise), and a reply to a reply is stored under the
// root. Sends the Comment webhook; an issue comment also starts agent mention runs
// and notifies participants.
export async function createComment(input: {
  parent: CommentParent;
  parentId?: string | null;
  body: string;
  actorUserId: string | null;
  id?: string;
}): Promise<CommentRow> {
  let rootId: string | null = null;
  if (input.parentId) {
    const replyTo = await getComment(input.parentId);
    if (!replyTo || !sameParent(input.parent, replyTo))
      throw new HttpError(400, 'parentId must be a comment on the same issue, project or update');
    rootId = replyTo.parentId ?? replyTo.id;
  }
  const [row] = await db
    .insert(comment)
    .values({
      ...(input.id ? { id: input.id } : {}),
      issueId: 'issueId' in input.parent ? input.parent.issueId : null,
      projectId: 'projectId' in input.parent ? input.parent.projectId : null,
      projectUpdateId: 'projectUpdateId' in input.parent ? input.parent.projectUpdateId : null,
      parentId: rootId,
      userId: input.actorUserId,
      userName: await userName(input.actorUserId),
      body: input.body,
    })
    .returning();
  const created = mapComment(row!);

  const teamIds = await commentTeamIds(created);
  const data = await commentData(created.id);
  if (data)
    await emitEvent({
      type: 'Comment',
      action: 'create',
      teamIds,
      actorUserId: input.actorUserId,
      data,
    });
  if (created.issueId && teamIds[0]) {
    await enqueueMentionRuns(teamIds[0], created);
    await notifyComment(teamIds[0], created);
  }
  return created;
}
