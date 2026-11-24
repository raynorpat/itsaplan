import { attachment, customerNeed, db, issue, user } from '@repo/db';
import { eq, inArray, sql, type SQL } from 'drizzle-orm';
import { canSeeTeam, visibleTeamIds, workspaceRole, type AuthUser } from '../shared/access';
import { HttpError } from '../shared/lib';

// Who reads and writes feedback (Linear's CustomerNeed) and requesters. Owners, admins
// and members who can see an issue's team read its feedback and add, change or delete
// it. Guests (app users read as guests) see no feedback and no requester, only the
// counts on issues, and cannot write it.

export async function readsFeedback(userId: string): Promise<boolean> {
  return (await workspaceRole(userId)) !== 'guest';
}

// SQL over `customer_need`: feedback on issues in the teams the user can see.
export function visibleNeedsSql(userId: string): SQL {
  return inArray(
    customerNeed.issueId,
    db
      .select({ id: issue.id })
      .from(issue)
      .where(inArray(issue.teamId, visibleTeamIds(userId))),
  );
}

// 404 when the issue is missing or its team hidden; 403 for a guest.
export async function assertFeedbackWrite(issueId: string, user: AuthUser): Promise<string> {
  const [row] = await db.select({ teamId: issue.teamId }).from(issue).where(eq(issue.id, issueId));
  if (!row || !(await canSeeTeam(row.teamId, user.id))) throw new HttpError(404, 'Issue not found');
  if (!(await readsFeedback(user.id)))
    throw new HttpError(403, 'Guests cannot add or change feedback');
  return row.teamId;
}

// SQL over `attachment`: hides feedback source attachments (their title is the
// requester's name) from a viewer who does not read feedback. Guests and app users have
// another workspace role than owner, admin or member.
export function feedbackAttachmentsVisibleSql(viewerId: string): SQL {
  return sql`(${attachment.sourceType} IS DISTINCT FROM 'feedback' OR EXISTS (
    SELECT 1 FROM ${user} WHERE ${user.id} = ${viewerId}
      AND ${user.workspaceRole} IN ('owner', 'admin', 'member')))`;
}
