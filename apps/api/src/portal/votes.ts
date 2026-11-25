import { db, issue, team } from '@repo/db';
import { eq, sql } from 'drizzle-orm';
import { addPortalVote, removePortalVotes } from '../feedback/store';
import { HttpError } from '../shared/lib';
import type { BoardRow } from './boards';
import { boardVotesSql } from './issues';
import { allow, LIMITS } from './rate-limit';
import type { Visitor } from './session';

// A vote is a feedback item (CustomerNeed) from the visitor's requester with a portal
// source attachment and no quote; one per person and issue. The vote count is the
// issue's people asking, so feedback the team logged for the visitor counts as their
// vote, and unvoting removes only the portal vote. On a board with Customer access the
// count is the board customer's people only (boardVotesSql).

export interface VoteState {
  voted: boolean;
  votes: number;
}

async function voteState(
  board: BoardRow,
  issueId: string,
  requesterId: string,
): Promise<VoteState> {
  const [row] = await db
    .select({
      votes: boardVotesSql(board),
      voted: sql<boolean>`EXISTS (
        SELECT 1 FROM customer_need n JOIN attachment a ON a.id = n.attachment_id
        WHERE n.issue_id = ${issue.id} AND n.archived_at IS NULL
          AND a.external_user_creator_id = ${requesterId})`,
    })
    .from(issue)
    // The join makes drizzle qualify the column names inside boardVotesSql.
    .innerJoin(team, eq(team.id, issue.teamId))
    .where(eq(issue.id, issueId));
  return { voted: row?.voted ?? false, votes: row?.votes ?? 0 };
}

function countVote(visitor: Visitor): void {
  const { votes } = LIMITS;
  if (!allow(`vote:${visitor.requesterId}`, votes.limit, votes.windowMs))
    throw new HttpError(429, 'Too many votes. Try again later.');
}

// The caller checks the visitor may read the issue on the board.
export async function castVote(
  board: BoardRow,
  issueId: string,
  visitor: Visitor,
): Promise<VoteState> {
  countVote(visitor);
  await addPortalVote(issueId, visitor.requesterId);
  return voteState(board, issueId, visitor.requesterId);
}

export async function removeVote(
  board: BoardRow,
  issueId: string,
  visitor: Visitor,
): Promise<VoteState> {
  countVote(visitor);
  await removePortalVotes(issueId, visitor.requesterId);
  return voteState(board, issueId, visitor.requesterId);
}
