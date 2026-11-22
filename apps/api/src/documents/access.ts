import { db, document, issue, teamMember } from '@repo/db';
import { eq, inArray, or, type SQL } from 'drizzle-orm';
import { getMembership } from '../members/store';
import { assertProjectAccess, projectsInTeams, teamsGranting } from '../projects/access';
import { assertPermission, type AuthUser } from '../shared/access';
import { HttpError } from '../shared/lib';

// Access to documents, through their parent. A project document is read through a
// team of the project granting projects.read and written with projects.edit; an
// issue document is read by members of the issue's team and written with
// work_items.edit there. 404 when the parent is not readable, 403 when readable
// but not writable.

export type DocumentParent = { projectId: string } | { issueId: string };

export async function assertDocumentParentAccess(
  parent: DocumentParent,
  user: AuthUser,
  action: 'read' | 'edit',
): Promise<void> {
  if ('projectId' in parent) {
    await assertProjectAccess(parent.projectId, user.id, action);
    return;
  }
  const [row] = await db
    .select({ teamId: issue.teamId })
    .from(issue)
    .where(eq(issue.id, parent.issueId));
  if (!row || !(await getMembership(row.teamId, user.id)))
    throw new HttpError(404, 'Issue not found');
  if (action === 'edit') await assertPermission(row.teamId, user, 'work_items', 'edit');
}

export async function canSeeDocument(userId: string, parent: DocumentParent): Promise<boolean> {
  return assertDocumentParentAccess(parent, { id: userId } as AuthUser, 'read').then(
    () => true,
    () => false,
  );
}

// SQL over `document`: the documents whose parent the user can read.
export async function visibleDocumentsSql(userId: string): Promise<SQL> {
  const projects = projectsInTeams(await teamsGranting(userId, 'read'));
  const memberTeams = db
    .select({ id: teamMember.teamId })
    .from(teamMember)
    .where(eq(teamMember.userId, userId));
  return or(
    inArray(document.projectId, projects),
    inArray(
      document.issueId,
      db.select({ id: issue.id }).from(issue).where(inArray(issue.teamId, memberTeams)),
    ),
  )!;
}
