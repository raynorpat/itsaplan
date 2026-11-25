import { db, projectUpdate, projectUpdateShare } from '@repo/db';
import { eq } from 'drizzle-orm';
import { assertProjectAccess } from '../projects/access';
import { atLeast, workspaceRole } from '../shared/access';
import { HttpError } from '../shared/lib';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// "Send to requesters" on a project update (Linear's ProjectUpdateCreateInput has no such
// field): marks the update shared, once; the requester updates job then sends it to the
// people following an issue of the project. Only the update's author or a workspace
// admin or owner who can see the project; guests never (they see no requesters).
export async function shareProjectUpdate(
  userId: string,
  body: { projectUpdateId?: unknown },
): Promise<{ shared: true }> {
  const id = body.projectUpdateId;
  if (typeof id !== 'string' || !UUID_RE.test(id))
    throw new HttpError(400, 'projectUpdateId is required');
  const role = await workspaceRole(userId);
  if (role === 'guest') throw new HttpError(403, 'Guests cannot send updates to requesters');
  const [update] = await db
    .select({ projectId: projectUpdate.projectId, userId: projectUpdate.userId })
    .from(projectUpdate)
    .where(eq(projectUpdate.id, id));
  if (!update) throw new HttpError(404, 'Project update not found');
  await assertProjectAccess(update.projectId, userId).catch(() => {
    throw new HttpError(404, 'Project update not found');
  });
  if (update.userId !== userId && !atLeast(role, 'admin'))
    throw new HttpError(403, 'Only the author or an admin can send this update to requesters');
  await db
    .insert(projectUpdateShare)
    .values({ projectUpdateId: id, sharedById: userId })
    .onConflictDoNothing();
  return { shared: true };
}
