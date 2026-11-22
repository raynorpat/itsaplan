import { db, issue, issueSubscription, teamMember } from '@repo/db';
import { and, asc, eq, inArray, notInArray } from 'drizzle-orm';

// Issue subscriptions (Linear's issue subscribers). Only members of the issue's team
// are subscribed, listed or notified; a row of a user who left the team stays and
// counts again if they rejoin.

const issueTeam = (issueId: string) =>
  db.select({ teamId: issue.teamId }).from(issue).where(eq(issue.id, issueId));

const membersOfIssueTeam = (issueId: string) =>
  db
    .select({ userId: teamMember.userId })
    .from(teamMember)
    .where(inArray(teamMember.teamId, issueTeam(issueId)));

// The given users who are not members of the issue's team.
export async function nonMembers(issueId: string, userIds: string[]): Promise<string[]> {
  if (userIds.length === 0) return [];
  const rows = await membersOfIssueTeam(issueId);
  const members = new Set(rows.map((r) => r.userId));
  return [...new Set(userIds)].filter((id) => !members.has(id));
}

// Subscribes the given users who are members of the issue's team; existing
// subscriptions are left as they are.
export async function subscribe(issueId: string, userIds: string[]): Promise<void> {
  const outside = new Set(await nonMembers(issueId, userIds));
  const ids = [...new Set(userIds)].filter((id) => !outside.has(id));
  if (ids.length === 0) return;
  await db
    .insert(issueSubscription)
    .values(ids.map((userId) => ({ issueId, userId })))
    .onConflictDoNothing();
}

export async function unsubscribe(issueId: string, userId: string): Promise<void> {
  await db
    .delete(issueSubscription)
    .where(and(eq(issueSubscription.issueId, issueId), eq(issueSubscription.userId, userId)));
}

// The subscribers who are members of the issue's team, oldest subscription first.
export async function subscriberIds(issueId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: issueSubscription.userId })
    .from(issueSubscription)
    .where(
      and(
        eq(issueSubscription.issueId, issueId),
        inArray(issueSubscription.userId, membersOfIssueTeam(issueId)),
      ),
    )
    .orderBy(asc(issueSubscription.createdAt), asc(issueSubscription.userId));
  return rows.map((r) => r.userId);
}

// Makes the given users the issue's subscribers (Linear's subscriberIds on update).
// Callers check membership first with nonMembers.
export async function replaceSubscribers(issueId: string, userIds: string[]): Promise<void> {
  const ids = [...new Set(userIds)];
  await db.transaction(async (tx) => {
    await tx
      .delete(issueSubscription)
      .where(
        ids.length
          ? and(eq(issueSubscription.issueId, issueId), notInArray(issueSubscription.userId, ids))
          : eq(issueSubscription.issueId, issueId),
      );
    if (ids.length)
      await tx
        .insert(issueSubscription)
        .values(ids.map((userId) => ({ issueId, userId })))
        .onConflictDoNothing();
  });
}
