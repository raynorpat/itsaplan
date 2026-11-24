import { attachment, customerNeed, db } from '@repo/db';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { addPortalVote, removePortalVotes } from '../feedback/store';
import { HttpError } from '../shared/lib';
import { allow, LIMITS } from './rate-limit';
import type { Visitor } from './session';

// A vote is a feedback item (CustomerNeed) from the visitor's requester with a portal
// source attachment and no quote; one per person and issue. The vote count is the
// issue's people asking, so feedback the team logged for the visitor counts as their
// vote, and unvoting removes only the portal vote.

export interface VoteState {
  voted: boolean;
  votes: number;
}

export async function voteState(issueId: string, requesterId: string | null): Promise<VoteState> {
  const [row] = await db
    .select({
      votes: sql<number>`count(DISTINCT ${attachment.externalUserCreatorId})::int`,
      voted: requesterId
        ? sql<boolean>`coalesce(bool_or(${attachment.externalUserCreatorId} = ${requesterId}), false)`
        : sql<boolean>`false`,
    })
    .from(customerNeed)
    .innerJoin(attachment, eq(attachment.id, customerNeed.attachmentId))
    .where(and(eq(customerNeed.issueId, issueId), isNull(customerNeed.archivedAt)));
  return { voted: row?.voted ?? false, votes: row?.votes ?? 0 };
}

function countVote(visitor: Visitor): void {
  const { votes } = LIMITS;
  if (!allow(`vote:${visitor.requesterId}`, votes.limit, votes.windowMs))
    throw new HttpError(429, 'Too many votes. Try again later.');
}

// The caller checks the visitor may read the issue on the board.
export async function castVote(issueId: string, visitor: Visitor): Promise<VoteState> {
  countVote(visitor);
  await addPortalVote(issueId, visitor.requesterId);
  return voteState(issueId, visitor.requesterId);
}

export async function removeVote(issueId: string, visitor: Visitor): Promise<VoteState> {
  countVote(visitor);
  await removePortalVotes(issueId, visitor.requesterId);
  return voteState(issueId, visitor.requesterId);
}
