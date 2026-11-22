import { reaction } from '@repo/db';
import { eq } from 'drizzle-orm';
import {
  assertReactionParentAccess,
  createReaction,
  deleteReaction,
  getReaction,
  groupReactions,
  listReactions,
  type ReactionParent,
  type ReactionRow,
} from '../../reactions/store';
import { getComment } from '../../comments/store';
import { UUID_RE } from '../../shared/lib';
import type { GraphQLContext } from '../context';
import { gqlError } from '../errors';
import { toComment } from './comment';
import { issueById, userById } from './issue';
import { guard, lastSyncId, onlySupported } from './mutations';

// Linear's Reaction, read through the item it is on (Issue, Comment, ProjectUpdate,
// InitiativeUpdate),
// with reactionCreate / reactionDelete. Access follows the item.

const toReaction = (r: ReactionRow) => ({ ...r, updatedAt: r.createdAt, archivedAt: null });

type ItemColumn =
  | typeof reaction.issueId
  | typeof reaction.commentId
  | typeof reaction.projectUpdateId
  | typeof reaction.initiativeUpdateId;

const byItem = (column: ItemColumn) => (item: { id: string }) =>
  listReactions(eq(column, item.id)).then((rows) => rows.map(toReaction));
const dataByItem = (column: ItemColumn) => (item: { id: string }) =>
  listReactions(eq(column, item.id)).then(groupReactions);

type CreateInput = Record<string, unknown> & {
  emoji: string;
  commentId?: string | null;
  issueId?: string | null;
  projectUpdateId?: string | null;
  initiativeUpdateId?: string | null;
  id?: string | null;
};

function parentOf(input: CreateInput): ReactionParent {
  const given = [
    input.commentId && { commentId: input.commentId },
    input.issueId && { issueId: input.issueId },
    input.projectUpdateId && { projectUpdateId: input.projectUpdateId },
    input.initiativeUpdateId && { initiativeUpdateId: input.initiativeUpdateId },
  ].filter(Boolean) as ReactionParent[];
  if (given.length !== 1)
    throw gqlError(
      'INVALID_INPUT',
      'Set exactly one of input.commentId, input.issueId, input.projectUpdateId, input.initiativeUpdateId',
    );
  for (const v of [
    input.commentId,
    input.issueId,
    input.projectUpdateId,
    input.initiativeUpdateId,
    input.id,
  ])
    if (v && !UUID_RE.test(v)) throw gqlError('INVALID_INPUT', `${v} is not a valid id`);
  return given[0]!;
}

export const reactionResolvers = {
  Issue: { reactions: byItem(reaction.issueId), reactionData: dataByItem(reaction.issueId) },
  Comment: { reactions: byItem(reaction.commentId), reactionData: dataByItem(reaction.commentId) },
  ProjectUpdate: {
    reactions: byItem(reaction.projectUpdateId),
    reactionData: dataByItem(reaction.projectUpdateId),
  },
  InitiativeUpdate: {
    reactions: byItem(reaction.initiativeUpdateId),
    reactionData: dataByItem(reaction.initiativeUpdateId),
  },
  Reaction: {
    user: (r: ReactionRow, _: unknown, ctx: GraphQLContext) => userById(r.userId, ctx.user.id),
    issue: (r: ReactionRow) => (r.issueId ? issueById(r.issueId) : null),
    comment: async (r: ReactionRow) => {
      if (!r.commentId) return null;
      const row = await getComment(r.commentId);
      return row ? toComment(row) : null;
    },
  },
  Mutation: {
    reactionCreate: (_: unknown, { input }: { input: CreateInput }, ctx: GraphQLContext) =>
      guard(async () => {
        onlySupported(
          input,
          ['emoji', 'commentId', 'issueId', 'projectUpdateId', 'initiativeUpdateId', 'id'],
          'input',
        );
        const parent = parentOf(input);
        await assertReactionParentAccess(parent, ctx.user);
        const created = await createReaction({
          parent,
          emoji: input.emoji,
          userId: ctx.user.id,
          id: input.id ?? undefined,
        });
        return { success: true, lastSyncId: lastSyncId(), reaction: toReaction(created) };
      }),
    reactionDelete: (_: unknown, { id }: { id: string }, ctx: GraphQLContext) =>
      guard(async () => {
        const found = UUID_RE.test(id) ? await getReaction(id) : null;
        if (!found) throw gqlError('ENTITY_NOT_FOUND', `Reaction ${id} not found`);
        await deleteReaction(id, ctx.user.id);
        return { success: true, lastSyncId: lastSyncId(), entityId: id };
      }),
  },
};
