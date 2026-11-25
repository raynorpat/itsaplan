import { db, teamMember, user } from '@repo/db';
import { and, eq } from 'drizzle-orm';
import {
  assertTeamAccess,
  canManageTeam,
  isAppUser,
  isTeamMember,
  type AuthUser,
} from '../shared/access';
import { HttpError } from '../shared/lib';
import { recordAudit, type AuditTx } from '../audit/store';

// Data access for team membership. A member is a team owner or a plain member
// (`team_member.owner`); the DTO's `role` reports which. Access itself is decided in
// shared/access.ts.

export type MemberRole = 'owner' | 'member';

const roleOf = (owner: boolean): MemberRole => (owner ? 'owner' : 'member');

// The user's role in a team, or null when they are not a member.
export async function getMembership(teamId: string, userId: string): Promise<MemberRole | null> {
  const rows = await db
    .select({ owner: teamMember.owner })
    .from(teamMember)
    .where(and(eq(teamMember.teamId, teamId), eq(teamMember.userId, userId)));
  return rows[0] ? roleOf(rows[0].owner) : null;
}

// Adds a user to a team. Upserts the owner flag when the user is already a member,
// so re-adding is idempotent and doubles as a role change.
export async function upsertMember(
  teamId: string,
  userId: string,
  role: MemberRole,
  ex: AuditTx | typeof db = db,
): Promise<void> {
  await ex
    .insert(teamMember)
    .values({ teamId, userId, owner: role === 'owner' })
    .onConflictDoUpdate({
      target: [teamMember.teamId, teamMember.userId],
      set: { owner: role === 'owner' },
    });
}

// Makes a member a team owner or a plain member. Returns false when the user is not
// a member of the team.
export async function setMembership(
  teamId: string,
  userId: string,
  role: MemberRole,
  ex: AuditTx | typeof db = db,
): Promise<boolean> {
  const updated = await ex
    .update(teamMember)
    .set({ owner: role === 'owner' })
    .where(and(eq(teamMember.teamId, teamId), eq(teamMember.userId, userId)))
    .returning({ userId: teamMember.userId });
  return updated.length > 0;
}

export async function removeMember(
  teamId: string,
  userId: string,
  ex: AuditTx | typeof db = db,
): Promise<void> {
  await ex
    .delete(teamMember)
    .where(and(eq(teamMember.teamId, teamId), eq(teamMember.userId, userId)));
}

// An application's app user gets its teams from its install (chosen by the installing
// admin) and loses them on uninstall; no membership change is made by it or to it.
export async function assertNotAppUser(...userIds: string[]): Promise<void> {
  for (const id of new Set(userIds))
    if (await isAppUser(id))
      throw new HttpError(400, "An application's teams are set when it is installed");
}

// Joins a team oneself (Linear's teamMembershipCreate for oneself); the caller has checked that the user can see the team.
export async function joinTeam(teamId: string, userId: string): Promise<void> {
  await assertNotAppUser(userId);
  if (await isTeamMember(teamId, userId)) return;
  await db.transaction(async (tx) => {
    await upsertMember(teamId, userId, 'member', tx);
    await recordAudit(
      'teamMemberAdded',
      { entityType: 'team', entityId: teamId, userId, owner: false },
      { tx, actorId: userId },
    );
  });
}

// Adds someone to a team (Linear's teamMembershipCreate). Any team member
// may add people to a public team; a private team, and making someone a team
// owner, need a team manager. Suspended users cannot be added.
export async function addTeamMember(
  teamRow: { id: string; visibility: string },
  targetUserId: string,
  owner: boolean,
  actor: AuthUser,
): Promise<void> {
  if (!(await canManageTeam(teamRow.id, actor.id))) {
    if (owner || teamRow.visibility === 'private')
      throw new HttpError(403, 'Only a team owner or a workspace admin can do this');
    if (!(await isTeamMember(teamRow.id, actor.id)))
      throw new HttpError(403, 'Join the team before adding people to it');
  }
  await assertNotAppUser(actor.id, targetUserId);
  const [target] = await db
    .select({ id: user.id, suspendedAt: user.suspendedAt })
    .from(user)
    .where(eq(user.id, targetUserId));
  if (!target) throw new HttpError(404, 'User not found');
  if (target.suspendedAt) throw new HttpError(400, 'This user is suspended');
  await db.transaction(async (tx) => {
    await upsertMember(teamRow.id, targetUserId, owner ? 'owner' : 'member', tx);
    await recordAudit(
      'teamMemberAdded',
      { entityType: 'team', entityId: teamRow.id, userId: targetUserId, owner },
      { tx, actorId: actor.id },
    );
  });
}

// Makes a member a team owner or a plain member: a team manager, never on oneself.
export async function changeTeamOwner(
  teamId: string,
  targetUserId: string,
  owner: boolean,
  actor: AuthUser,
): Promise<void> {
  await assertTeamAccess(teamId, actor, 'manage');
  await assertNotAppUser(actor.id, targetUserId);
  if (targetUserId === actor.id) throw new HttpError(400, 'You cannot change your own role');
  await db.transaction(async (tx) => {
    const ok = await setMembership(teamId, targetUserId, owner ? 'owner' : 'member', tx);
    if (!ok) throw new HttpError(404, 'Member not found');
    await recordAudit(
      'teamOwnerChanged',
      { entityType: 'team', entityId: teamId, userId: targetUserId, owner },
      { tx, actorId: actor.id },
    );
  });
}

// Removes a member: anyone may leave; removing someone else needs a team manager.
export async function removeTeamMember(
  teamId: string,
  targetUserId: string,
  actor: AuthUser,
): Promise<void> {
  if (targetUserId !== actor.id) await assertTeamAccess(teamId, actor, 'manage');
  await assertNotAppUser(actor.id, targetUserId);
  if (!(await getMembership(teamId, targetUserId))) throw new HttpError(404, 'Member not found');
  await db.transaction(async (tx) => {
    await removeMember(teamId, targetUserId, tx);
    await recordAudit(
      'teamMemberRemoved',
      { entityType: 'team', entityId: teamId, userId: targetUserId },
      { tx, actorId: actor.id },
    );
  });
}
