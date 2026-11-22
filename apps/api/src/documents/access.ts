import { db, document, issue } from '@repo/db';
import { eq, inArray, or, type SQL } from 'drizzle-orm';
import { assertProjectAccess, projectsInTeams } from '../projects/access';
import { canSeeTeam, visibleTeamIdList, visibleTeamIds, type AuthUser } from '../shared/access';
import { HttpError } from '../shared/lib';

// Access to documents, through their parent: a document is read and written by
// whoever can see its project or issue (shared/access.ts). 404 otherwise.

export type DocumentParent = { projectId: string } | { issueId: string };

export async function assertDocumentParentAccess(
  parent: DocumentParent,
  user: AuthUser,
): Promise<void> {
  if ('projectId' in parent) {
    await assertProjectAccess(parent.projectId, user.id);
    return;
  }
  const [row] = await db
    .select({ teamId: issue.teamId })
    .from(issue)
    .where(eq(issue.id, parent.issueId));
  if (!row || !(await canSeeTeam(row.teamId, user.id))) throw new HttpError(404, 'Issue not found');
}

export async function canSeeDocument(userId: string, parent: DocumentParent): Promise<boolean> {
  return assertDocumentParentAccess(parent, { id: userId } as AuthUser).then(
    () => true,
    () => false,
  );
}

// SQL over `document`: the documents whose parent the user can read.
export async function visibleDocumentsSql(userId: string): Promise<SQL> {
  const projects = projectsInTeams(await visibleTeamIdList(userId));
  const memberTeams = visibleTeamIds(userId);
  return or(
    inArray(document.projectId, projects),
    inArray(
      document.issueId,
      db.select({ id: issue.id }).from(issue).where(inArray(issue.teamId, memberTeams)),
    ),
  )!;
}
