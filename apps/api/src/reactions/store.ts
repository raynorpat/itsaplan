import { db, issue, projectTeam, projectUpdate, reaction } from '@repo/db';
import { asc, eq, type SQL } from 'drizzle-orm';
import { HttpError, iso, rethrowDuplicate } from '../shared/lib';
import type { AuthUser } from '../shared/access';
import { assertParentAccess, commentParent, commentTeamIds, getComment } from '../comments/store';
import { emitEvent } from '../webhooks/event';

// Emoji reactions (Linear's Reaction) on a comment, an issue or a project update.
// A user reacts once with each exact emoji on an item; only that user removes it.

export type ReactionParent =
  { commentId: string } | { issueId: string } | { projectUpdateId: string };

export interface ReactionRow {
  id: string;
  commentId: string | null;
  issueId: string | null;
  projectUpdateId: string | null;
  userId: string;
  emoji: string;
  createdAt: string;
}

export function mapReaction(row: typeof reaction.$inferSelect): ReactionRow {
  return {
    id: row.id,
    commentId: row.commentId,
    issueId: row.issueId,
    projectUpdateId: row.projectUpdateId,
    userId: row.userId,
    emoji: row.emoji,
    createdAt: iso(row.createdAt),
  };
}

// Linear's Reaction as webhook data.
export function reactionWebhookData(r: ReactionRow) {
  return { ...r, updatedAt: r.createdAt, archivedAt: null };
}

// Read access to the item a reaction is on (404 when the viewer cannot read it).
export async function assertReactionParentAccess(parent: ReactionParent, user: AuthUser) {
  if ('commentId' in parent) {
    const found = await getComment(parent.commentId);
    if (!found) throw new HttpError(404, 'Comment not found');
    return assertParentAccess(commentParent(found), user, 'read');
  }
  return assertParentAccess(parent, user, 'read');
}

// The teams of the item a reaction is on, for its webhook events.
async function reactionTeamIds(r: ReactionRow): Promise<string[]> {
  if (r.commentId) {
    const found = await getComment(r.commentId);
    return found ? commentTeamIds(found) : [];
  }
  if (r.issueId) {
    const [row] = await db
      .select({ teamId: issue.teamId })
      .from(issue)
      .where(eq(issue.id, r.issueId));
    return row ? [row.teamId] : [];
  }
  const rows = await db
    .select({ teamId: projectTeam.teamId })
    .from(projectUpdate)
    .innerJoin(projectTeam, eq(projectTeam.projectId, projectUpdate.projectId))
    .where(eq(projectUpdate.id, r.projectUpdateId!));
  return rows.map((t) => t.teamId);
}

async function sendReactionEvent(action: 'create' | 'remove', r: ReactionRow, actorUserId: string) {
  await emitEvent({
    type: 'Reaction',
    action,
    teamIds: await reactionTeamIds(r),
    actorUserId,
    data: reactionWebhookData(r),
  });
}

// Adds a reaction. The emoji is trimmed and must be 1-64 characters (400); the same
// user reacting with the same emoji on the same item again is 409.
export async function createReaction(input: {
  parent: ReactionParent;
  emoji: string;
  userId: string;
  id?: string;
}): Promise<ReactionRow> {
  const emoji = input.emoji.trim();
  if (emoji.length < 1 || emoji.length > 64)
    throw new HttpError(400, 'emoji must be 1 to 64 characters');
  try {
    const [row] = await db
      .insert(reaction)
      .values({
        ...(input.id ? { id: input.id } : {}),
        commentId: 'commentId' in input.parent ? input.parent.commentId : null,
        issueId: 'issueId' in input.parent ? input.parent.issueId : null,
        projectUpdateId: 'projectUpdateId' in input.parent ? input.parent.projectUpdateId : null,
        userId: input.userId,
        emoji,
      })
      .returning();
    const created = mapReaction(row!);
    await sendReactionEvent('create', created, input.userId);
    return created;
  } catch (err) {
    rethrowDuplicate(err, 'reaction');
  }
}

// Removes a reaction; only the user who added it may (403), 404 when missing.
export async function deleteReaction(id: string, userId: string): Promise<void> {
  const [row] = await db.select().from(reaction).where(eq(reaction.id, id));
  if (!row) throw new HttpError(404, 'Reaction not found');
  if (row.userId !== userId) throw new HttpError(403, 'Only the user who reacted can remove it');
  await db.delete(reaction).where(eq(reaction.id, id));
  await sendReactionEvent('remove', mapReaction(row), userId);
}

export async function getReaction(id: string): Promise<ReactionRow | null> {
  const [row] = await db.select().from(reaction).where(eq(reaction.id, id));
  return row ? mapReaction(row) : null;
}

// The reactions on one item, oldest first.
export async function listReactions(where: SQL): Promise<ReactionRow[]> {
  const rows = await db
    .select()
    .from(reaction)
    .where(where)
    .orderBy(asc(reaction.createdAt), asc(reaction.id));
  return rows.map(mapReaction);
}

// Reactions grouped by emoji, in order of each emoji's first reaction (Linear's
// reactionData).
export function groupReactions(rows: ReactionRow[]) {
  const groups = new Map<
    string,
    { emoji: string; count: number; userIds: string[]; reactionIds: string[] }
  >();
  for (const r of rows) {
    const g = groups.get(r.emoji) ?? { emoji: r.emoji, count: 0, userIds: [], reactionIds: [] };
    g.count += 1;
    g.userIds.push(r.userId);
    g.reactionIds.push(r.id);
    groups.set(r.emoji, g);
  }
  return [...groups.values()];
}
