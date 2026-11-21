import { comment, db, issue, projectTeam, projectUpdate, team, teamMember, user } from '@repo/db';
import { trustedOrigins } from '@repo/auth';
import { eq, inArray, or, type SQL } from 'drizzle-orm';
import { HttpError, iso } from '../shared/lib';
import type { FeedItemRow } from '../issues/activity';
import { emitEvent } from '../webhooks/event';
import { commentData } from '../webhooks/data';
import { enqueueMentionRuns } from '../issues/activity';
import { notifyComment } from '../notifications/store';
import { parseMentions } from '../ai-agents/mentions';
import { getMembership } from '../members/store';
import { assertPermission, type AuthUser } from '../shared/access';
import { assertProjectAccess, projectsInTeams, teamsGranting } from '../projects/access';

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

// --- Changes and access ----------------------------------------------------------

async function sendCommentEvent(
  action: 'update' | 'remove',
  c: CommentRow,
  actorUserId: string | null,
  data: Record<string, unknown> | null,
  before?: Record<string, unknown> | null,
): Promise<void> {
  if (!data) return;
  await emitEvent({
    type: 'Comment',
    action,
    teamIds: await commentTeamIds(c),
    actorUserId,
    data,
    before: before ?? undefined,
  });
}

async function findComment(id: string): Promise<CommentRow> {
  const found = await getComment(id);
  if (!found) throw new HttpError(404, 'Comment not found');
  return found;
}

// Replaces the body (author only, 403 otherwise) and sets edited_at. Members and
// agents mentioned by the edit for the first time are notified and get runs.
export async function updateComment(
  id: string,
  body: string,
  actorUserId: string,
): Promise<CommentRow> {
  const before = await findComment(id);
  if (before.userId !== actorUserId) throw new HttpError(403, 'Only the author can edit a comment');
  const beforeData = await commentData(id);
  const [row] = await db
    .update(comment)
    .set({ body, editedAt: new Date(), updatedAt: new Date() })
    .where(eq(comment.id, id))
    .returning();
  const updated = mapComment(row!);
  await sendCommentEvent('update', updated, actorUserId, await commentData(id), beforeData);
  if (updated.issueId) {
    const known = new Set(parseMentions(before.body));
    const added = parseMentions(body).filter((u) => !known.has(u));
    const [teamId] = await commentTeamIds(updated);
    if (added.length && teamId) {
      await enqueueMentionRuns(teamId, updated, added);
      await notifyComment(teamId, updated, { onlyMentioned: added });
    }
  }
  return updated;
}

// Deletes a comment (its replies go with it). The author, or an owner of one of the
// comment's teams, may delete; 403 otherwise.
export async function deleteComment(id: string, actorUserId: string): Promise<void> {
  const found = await findComment(id);
  if (found.userId !== actorUserId) {
    const owners = await Promise.all(
      (await commentTeamIds(found)).map((t) => getMembership(t, actorUserId)),
    );
    if (!owners.includes('owner'))
      throw new HttpError(403, 'Only the author or a team owner can delete a comment');
  }
  const beforeData = await commentData(id);
  await db.delete(comment).where(eq(comment.id, id));
  await sendCommentEvent('remove', found, actorUserId, beforeData);
}

// Marks a root comment's thread resolved, optionally naming the reply that resolved
// it. 400 for a reply or a resolving comment outside the thread.
export async function resolveComment(
  id: string,
  actorUserId: string,
  resolvingCommentId?: string | null,
): Promise<CommentRow> {
  const found = await findComment(id);
  if (found.parentId) throw new HttpError(400, 'Only a root comment can be resolved');
  if (resolvingCommentId) {
    const reply = await getComment(resolvingCommentId);
    if (reply?.parentId !== id)
      throw new HttpError(400, 'resolvingCommentId must be a reply in this thread');
  }
  return setResolved(found, actorUserId, {
    resolvedAt: new Date(),
    resolvingUserId: actorUserId,
    resolvingCommentId: resolvingCommentId ?? null,
  });
}

export async function unresolveComment(id: string, actorUserId: string): Promise<CommentRow> {
  const found = await findComment(id);
  if (found.parentId) throw new HttpError(400, 'Only a root comment can be resolved');
  return setResolved(found, actorUserId, {
    resolvedAt: null,
    resolvingUserId: null,
    resolvingCommentId: null,
  });
}

async function setResolved(
  found: CommentRow,
  actorUserId: string,
  set: {
    resolvedAt: Date | null;
    resolvingUserId: string | null;
    resolvingCommentId: string | null;
  },
): Promise<CommentRow> {
  const beforeData = await commentData(found.id);
  const [row] = await db
    .update(comment)
    .set({ ...set, updatedAt: new Date() })
    .where(eq(comment.id, found.id))
    .returning();
  const updated = mapComment(row!);
  await sendCommentEvent('update', updated, actorUserId, await commentData(found.id), beforeData);
  return updated;
}

// Access to a comment's parent for `action`: an issue through team membership
// (create needs work_items.create), a project or project update through a team
// granting projects.read. 404 when the viewer cannot read it.
export async function assertParentAccess(
  parent: CommentParent,
  user: AuthUser,
  action: 'read' | 'create',
): Promise<void> {
  if ('issueId' in parent) {
    const [row] = await db
      .select({ teamId: issue.teamId })
      .from(issue)
      .where(eq(issue.id, parent.issueId));
    if (!row || !(await getMembership(row.teamId, user.id)))
      throw new HttpError(404, 'Issue not found');
    if (action === 'create') await assertPermission(row.teamId, user, 'work_items', 'create');
    return;
  }
  let projectId = 'projectId' in parent ? parent.projectId : null;
  if ('projectUpdateId' in parent) {
    const [row] = await db
      .select({ projectId: projectUpdate.projectId })
      .from(projectUpdate)
      .where(eq(projectUpdate.id, parent.projectUpdateId));
    if (!row) throw new HttpError(404, 'Project update not found');
    projectId = row.projectId;
  }
  await assertProjectAccess(projectId!, user.id, 'read');
}

// The comment's parent, for assertParentAccess.
export function commentParent(c: CommentRow): CommentParent {
  if (c.issueId) return { issueId: c.issueId };
  if (c.projectId) return { projectId: c.projectId };
  return { projectUpdateId: c.projectUpdateId! };
}

// SQL over `comment`: the comments a user can read (their teams' issues, and the
// projects / project updates of teams granting projects.read).
export async function readableCommentsSql(userId: string): Promise<SQL> {
  const projects = projectsInTeams(await teamsGranting(userId, 'read'));
  const memberTeams = db
    .select({ id: teamMember.teamId })
    .from(teamMember)
    .where(eq(teamMember.userId, userId));
  return or(
    inArray(
      comment.issueId,
      db.select({ id: issue.id }).from(issue).where(inArray(issue.teamId, memberTeams)),
    ),
    inArray(comment.projectId, projects),
    inArray(
      comment.projectUpdateId,
      db
        .select({ id: projectUpdate.id })
        .from(projectUpdate)
        .where(inArray(projectUpdate.projectId, projects)),
    ),
  )!;
}
