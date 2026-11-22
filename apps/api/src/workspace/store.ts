import { db, session, user } from '@repo/db';
import { and, asc, eq, sql } from 'drizzle-orm';
import { atLeast, workspaceRole, type WorkspaceRole } from '../shared/access';
import { HttpError, iso } from '../shared/lib';

// Workspace users and their administration: role changes and suspension (Linear's
// way to remove someone). Admins act on members and guests; owners on anyone; only
// owners make or remove owners; the workspace always keeps an owner.

export interface WorkspaceUserRow {
  userId: string;
  name: string;
  email: string;
  image: string | null;
  role: WorkspaceRole;
  suspendedAt: string | null;
  createdAt: string;
}

export async function listWorkspaceUsers(): Promise<WorkspaceUserRow[]> {
  const rows = await db
    .select({
      userId: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      role: user.workspaceRole,
      suspendedAt: user.suspendedAt,
      createdAt: user.createdAt,
    })
    .from(user)
    .orderBy(asc(user.name));
  return rows.map((r) => ({
    ...r,
    role: r.role as WorkspaceRole,
    suspendedAt: r.suspendedAt ? iso(r.suspendedAt) : null,
    createdAt: iso(r.createdAt),
  }));
}

async function activeOwnerCount(): Promise<number> {
  return db.$count(user, and(eq(user.workspaceRole, 'owner'), sql`${user.suspendedAt} IS NULL`));
}

// Checks the actor may act on the target, and returns the target's current role.
async function assertMayAdminister(actorId: string, targetId: string): Promise<WorkspaceRole> {
  const actor = await workspaceRole(actorId);
  if (!atLeast(actor, 'admin')) throw new HttpError(403, 'Only a workspace admin can do this');
  const [target] = await db
    .select({ role: user.workspaceRole })
    .from(user)
    .where(eq(user.id, targetId));
  if (!target) throw new HttpError(404, 'User not found');
  const current = target.role as WorkspaceRole;
  if (actor === 'admin' && atLeast(current, 'admin'))
    throw new HttpError(403, 'An admin can only change members and guests');
  return current;
}

export async function changeWorkspaceRole(
  targetId: string,
  role: WorkspaceRole,
  actorId: string,
): Promise<WorkspaceUserRow> {
  const current = await assertMayAdminister(actorId, targetId);
  if (!atLeast(await workspaceRole(actorId), role))
    throw new HttpError(403, 'You cannot give someone a role above your own');
  if (current === 'owner' && role !== 'owner' && (await activeOwnerCount()) <= 1)
    throw new HttpError(400, 'The workspace needs at least one owner');
  await db.update(user).set({ workspaceRole: role }).where(eq(user.id, targetId));
  return (await listWorkspaceUsers()).find((u) => u.userId === targetId)!;
}

// Suspends a user: no sign-in, their sessions end, their API keys stop working.
// Memberships and history stay.
export async function suspendUser(targetId: string, actorId: string): Promise<void> {
  if (targetId === actorId) throw new HttpError(400, 'You cannot suspend yourself');
  const current = await assertMayAdminister(actorId, targetId);
  if (current === 'owner' && (await activeOwnerCount()) <= 1)
    throw new HttpError(400, 'The workspace needs at least one owner');
  await db.transaction(async (tx) => {
    await tx.update(user).set({ suspendedAt: new Date() }).where(eq(user.id, targetId));
    await tx.delete(session).where(eq(session.userId, targetId));
  });
}

export async function unsuspendUser(targetId: string, actorId: string): Promise<void> {
  await assertMayAdminister(actorId, targetId);
  await db.update(user).set({ suspendedAt: null }).where(eq(user.id, targetId));
}
