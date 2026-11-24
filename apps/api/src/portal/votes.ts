import { attachment, customerNeed, db } from '@repo/db';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { createNeed, createRequesterAttachment, deleteNeed } from '../feedback/store';
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

// The visitor's portal votes on the issue (portal source, no quote).
async function portalVoteIds(issueId: string, requesterId: string): Promise<string[]> {
  const rows = await db
    .select({ id: customerNeed.id })
    .from(customerNeed)
    .innerJoin(attachment, eq(attachment.id, customerNeed.attachmentId))
    .where(
      and(
        eq(customerNeed.issueId, issueId),
        isNull(customerNeed.body),
        eq(attachment.externalUserCreatorId, requesterId),
        sql`${attachment.metadata}->>'source' = 'portal'`,
      ),
    );
  return rows.map((r) => r.id);
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

// Runs `work` while holding a lock for this person and issue, so two votes at once
// make one feedback item. The work writes through the stores on other connections; an
// advisory lock does not conflict with their foreign-key checks.
async function underVoteLock(issueId: string, requesterId: string, work: () => Promise<void>) {
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`portal-vote:${requesterId}:${issueId}`}))`,
    );
    await work();
  });
}

function countVote(visitor: Visitor): void {
  const { votes } = LIMITS;
  if (!allow(`vote:${visitor.requesterId}`, votes.limit, votes.windowMs))
    throw new HttpError(429, 'Too many votes. Try again later.');
}

// The caller checks the visitor may read the issue on the board.
export async function castVote(issueId: string, visitor: Visitor): Promise<VoteState> {
  countVote(visitor);
  await underVoteLock(issueId, visitor.requesterId, async () => {
    const { voted } = await voteState(issueId, visitor.requesterId);
    if (voted) return;
    const { attachmentId } = await createRequesterAttachment(
      issueId,
      visitor.requesterId,
      'portal',
      null,
    );
    await createNeed({ issueId, attachmentId, body: null, creatorId: null });
  });
  return voteState(issueId, visitor.requesterId);
}

export async function removeVote(issueId: string, visitor: Visitor): Promise<VoteState> {
  countVote(visitor);
  await underVoteLock(issueId, visitor.requesterId, async () => {
    for (const id of await portalVoteIds(issueId, visitor.requesterId))
      await deleteNeed(id, false, null);
  });
  return voteState(issueId, visitor.requesterId);
}
