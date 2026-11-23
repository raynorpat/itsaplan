import {
  comment,
  db,
  initiative,
  initiativeUpdate,
  document,
  issue,
  projectTeam,
  projectUpdate,
  team,
  user,
} from '@repo/db';
import { trustedOrigins } from '@repo/auth';
import { eq, inArray, or, type SQL } from 'drizzle-orm';
import { HttpError, iso } from '../shared/lib';
import type { FeedItemRow } from '../issues/activity';
import { emitEvent } from '../webhooks/event';
import { commentData } from '../webhooks/data';
import { notifyComment } from '../notifications/store';
import { parseMentions } from '../shared/mentions';
import { assertThreadDeletable, bestEffort, commentPosted } from '../agents/store';
import {
  assertTeamAccess,
  type AuthUser,
  visibleTeamIdList,
  canManageTeam,
  visibleTeamIds,
} from '../shared/access';
import { assertProjectAccess, projectsInTeams } from '../projects/access';
import { assertInitiativeAccess, visibleInitiativesSql } from '../initiatives/access';
import { getInitiative, initiativeUrl } from '../initiatives/store';
import { assertDocumentParentAccess, visibleDocumentsSql } from '../documents/access';
import { documentPageUrl, documentParent, documentTeamIds, getDocument } from '../documents/store';

// Comments (Linear's Comment) on an issue, a project, a project update, an
// initiative update or a document. A reply belongs to the thread of a root comment:
// replying to a reply stores the new comment under that reply's root, so threads
// are one level deep (Linear).

export type CommentParent =
  | { issueId: string }
  | { projectId: string }
  | { projectUpdateId: string }
  | { initiativeUpdateId: string }
  | { documentId: string };

export interface CommentRow {
  id: string;
  issueId: string | null;
  projectId: string | null;
  projectUpdateId: string | null;
  initiativeUpdateId: string | null;
  documentId: string | null;
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
    initiativeUpdateId: row.initiativeUpdateId,
    documentId: row.documentId,
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

// The project a project update belongs to, or null when the update does not exist.
async function updateProjectId(projectUpdateId: string): Promise<string | null> {
  const [row] = await db
    .select({ projectId: projectUpdate.projectId })
    .from(projectUpdate)
    .where(eq(projectUpdate.id, projectUpdateId));
  return row?.projectId ?? null;
}

// The initiative an initiative update belongs to, or null when the update does not
// exist.
async function updateInitiativeId(initiativeUpdateId: string): Promise<string | null> {
  const [row] = await db
    .select({ initiativeId: initiativeUpdate.initiativeId })
    .from(initiativeUpdate)
    .where(eq(initiativeUpdate.id, initiativeUpdateId));
  return row?.initiativeId ?? null;
}

// The web URL of the issue, project, project update, initiative update or
// document a comment is on.
export async function commentParentUrl(c: CommentRow): Promise<string> {
  if (c.documentId) {
    const found = await getDocument(c.documentId);
    return found ? documentPageUrl(found) : trustedOrigins[0]!;
  }
  if (c.initiativeUpdateId)
    return initiativeUrl((await updateInitiativeId(c.initiativeUpdateId)) ?? '');
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
    projectId = await updateProjectId(c.projectUpdateId);
  }
  return `${trustedOrigins[0]}/projects/${projectId ?? ''}`;
}

const sameParent = (a: CommentParent, b: CommentRow) =>
  ('issueId' in a && a.issueId === b.issueId) ||
  ('projectId' in a && a.projectId === b.projectId) ||
  ('projectUpdateId' in a && a.projectUpdateId === b.projectUpdateId) ||
  ('initiativeUpdateId' in a && a.initiativeUpdateId === b.initiativeUpdateId) ||
  ('documentId' in a && a.documentId === b.documentId);

// The teams a comment belongs to: its issue's team, its project's (or its project
// update's project's) teams, or its initiative update's lead team (none for a
// workspace initiative), or its document's parent's teams.
export async function commentTeamIds(c: CommentRow): Promise<string[]> {
  if (c.documentId) {
    const found = await getDocument(c.documentId);
    return found ? documentTeamIds(documentParent(found)) : [];
  }
  if (c.initiativeUpdateId) {
    const initiativeId = await updateInitiativeId(c.initiativeUpdateId);
    const parent = initiativeId ? await getInitiative(initiativeId) : null;
    return parent?.leadTeamId ? [parent.leadTeamId] : [];
  }
  if (c.issueId) {
    const [row] = await db
      .select({ teamId: issue.teamId })
      .from(issue)
      .where(eq(issue.id, c.issueId));
    return row ? [row.teamId] : [];
  }
  let projectId = c.projectId;
  if (!projectId && c.projectUpdateId) {
    projectId = await updateProjectId(c.projectUpdateId);
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
// root. Sends the Comment webhook; an issue comment also notifies participants
// (unless `notify` is false) and starts or prompts the agent sessions of the apps it
// mentions.
export async function createComment(input: {
  parent: CommentParent;
  parentId?: string | null;
  body: string;
  actorUserId: string | null;
  id?: string;
  notify?: boolean;
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
      initiativeUpdateId:
        'initiativeUpdateId' in input.parent ? input.parent.initiativeUpdateId : null,
      documentId: 'documentId' in input.parent ? input.parent.documentId : null,
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
    if (input.notify !== false) await notifyComment(teamIds[0], created);
    await bestEffort('mention sessions', () => commentPosted(created, teamIds[0]!));
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
    if (added.length && teamId) await notifyComment(teamId, updated, { onlyMentioned: added });
  }
  return updated;
}

// Deletes a comment (its replies go with it). The author, or a manager of one of
// the comment's teams, may delete; 403 otherwise.
export async function deleteComment(id: string, actorUserId: string): Promise<void> {
  const found = await findComment(id);
  if (found.userId !== actorUserId) {
    const managers = await Promise.all(
      (await commentTeamIds(found)).map((t) => canManageTeam(t, actorUserId)),
    );
    if (!managers.includes(true))
      throw new HttpError(403, 'Only the author or a team manager can delete a comment');
  }
  await assertThreadDeletable(id, actorUserId);
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

// Access to a comment's parent: reading and commenting both need the parent to be
// visible (an issue through its team, a project or update through one of its
// teams). 404 when the viewer cannot see it.
export async function assertParentAccess(parent: CommentParent, user: AuthUser): Promise<void> {
  if ('issueId' in parent) {
    const [row] = await db
      .select({ teamId: issue.teamId })
      .from(issue)
      .where(eq(issue.id, parent.issueId));
    if (!row) throw new HttpError(404, 'Issue not found');
    await assertTeamAccess(row.teamId, user, 'see', 'Issue not found');
    return;
  }
  if ('documentId' in parent) {
    const found = await getDocument(parent.documentId);
    if (!found) throw new HttpError(404, 'Document not found');
    await assertDocumentParentAccess(documentParent(found), user);
    return;
  }
  if ('initiativeUpdateId' in parent) {
    const initiativeId = await updateInitiativeId(parent.initiativeUpdateId);
    if (!initiativeId) throw new HttpError(404, 'Initiative update not found');
    await assertInitiativeAccess(initiativeId, user.id);
    return;
  }
  let projectId = 'projectId' in parent ? parent.projectId : null;
  if ('projectUpdateId' in parent) {
    projectId = await updateProjectId(parent.projectUpdateId);
    if (!projectId) throw new HttpError(404, 'Project update not found');
  }
  await assertProjectAccess(projectId!, user.id);
}

// The comment's parent, for assertParentAccess.
export function commentParent(c: CommentRow): CommentParent {
  if (c.issueId) return { issueId: c.issueId };
  if (c.projectId) return { projectId: c.projectId };
  if (c.initiativeUpdateId) return { initiativeUpdateId: c.initiativeUpdateId };
  if (c.documentId) return { documentId: c.documentId };
  return { projectUpdateId: c.projectUpdateId! };
}

// SQL over `comment`: the comments a user can read (issues, projects and project
// updates of the teams they can see).
export async function readableCommentsSql(userId: string): Promise<SQL> {
  const projects = projectsInTeams(await visibleTeamIdList(userId));
  const memberTeams = visibleTeamIds(userId);
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
    inArray(
      comment.initiativeUpdateId,
      db
        .select({ id: initiativeUpdate.id })
        .from(initiativeUpdate)
        .innerJoin(initiative, eq(initiative.id, initiativeUpdate.initiativeId))
        .where(await visibleInitiativesSql(userId)),
    ),
    inArray(
      comment.documentId,
      db
        .select({ id: document.id })
        .from(document)
        .where(await visibleDocumentsSql(userId)),
    ),
  )!;
}
