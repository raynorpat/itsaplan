import { db, teamMember, user } from '@repo/db';
import { and, eq, ne } from 'drizzle-orm';
import { APP_ROLE } from '@repo/auth';
import { assertTeamAccess, canManageTeam, isTeamMember, type AuthUser } from '../shared/access';
import { HttpError, iso } from '../shared/lib';

// Data access for team membership. A member is a team owner or a plain member
// (`team_member.owner`); the DTO's `role` reports which. Access itself is decided in
// shared/access.ts.

export type MemberRole = 'owner' | 'member';

export interface MemberRow {
  userId: string;
  name: string;
  email: string;
  image: string | null;
  role: MemberRole;
  createdAt: string;
}

const roleOf = (owner: boolean): MemberRole => (owner ? 'owner' : 'member');

// The user's role in a team, or null when they are not a member.
export async function getMembership(teamId: string, userId: string): Promise<MemberRole | null> {
  const rows = await db
    .select({ owner: teamMember.owner })
    .from(teamMember)
    .where(and(eq(teamMember.teamId, teamId), eq(teamMember.userId, userId)));
  return rows[0] ? roleOf(rows[0].owner) : null;
}

// A team member an issue can be assigned to, with their owner/member flag.
export interface AssigneeCandidate {
  userId: string;
  name: string;
  email: string;
  image: string | null;
  role: MemberRole;
}

export async function listAssigneeCandidates(teamId: string): Promise<AssigneeCandidate[]> {
  const rows = await db
    .select({
      userId: teamMember.userId,
      name: user.name,
      email: user.email,
      image: user.image,
      owner: teamMember.owner,
    })
    .from(teamMember)
    .innerJoin(user, eq(user.id, teamMember.userId))
    // An app user is never the assignee (Linear makes it the delegate).
    .where(and(eq(teamMember.teamId, teamId), ne(user.workspaceRole, APP_ROLE)));
  return rows
    .map(({ owner, ...r }) => ({ ...r, role: roleOf(owner) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function listMembers(teamId: string): Promise<MemberRow[]> {
  const rows = await db
    .select({
      userId: teamMember.userId,
      name: user.name,
      email: user.email,
      image: user.image,
      owner: teamMember.owner,
      createdAt: teamMember.createdAt,
    })
    .from(teamMember)
    .innerJoin(user, eq(user.id, teamMember.userId))
    // App users are left out of member lists (Linear lists apps separately).
    .where(and(eq(teamMember.teamId, teamId), ne(user.workspaceRole, APP_ROLE)))
    .orderBy(teamMember.createdAt);
  return rows.map((r) => ({
    userId: r.userId,
    name: r.name,
    email: r.email,
    image: r.image,
    role: roleOf(r.owner),
    createdAt: iso(r.createdAt),
  }));
}

// Adds a user to a team. Upserts the owner flag when the user is already a member,
// so re-adding is idempotent and doubles as a role change.
export async function upsertMember(
  teamId: string,
  userId: string,
  role: MemberRole,
): Promise<void> {
  await db
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
): Promise<boolean> {
  const updated = await db
    .update(teamMember)
    .set({ owner: role === 'owner' })
    .where(and(eq(teamMember.teamId, teamId), eq(teamMember.userId, userId)))
    .returning({ userId: teamMember.userId });
  return updated.length > 0;
}

export async function removeMember(teamId: string, userId: string): Promise<void> {
  await db
    .delete(teamMember)
    .where(and(eq(teamMember.teamId, teamId), eq(teamMember.userId, userId)));
}

// Adds someone to a team (REST and Linear's teamMembershipCreate). Any team member
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
  const [target] = await db
    .select({ id: user.id, suspendedAt: user.suspendedAt })
    .from(user)
    .where(eq(user.id, targetUserId));
  if (!target) throw new HttpError(404, 'User not found');
  if (target.suspendedAt) throw new HttpError(400, 'This user is suspended');
  await upsertMember(teamRow.id, targetUserId, owner ? 'owner' : 'member');
}

// Makes a member a team owner or a plain member: a team manager, never on oneself.
export async function changeTeamOwner(
  teamId: string,
  targetUserId: string,
  owner: boolean,
  actor: AuthUser,
): Promise<void> {
  await assertTeamAccess(teamId, actor, 'manage');
  if (targetUserId === actor.id) throw new HttpError(400, 'You cannot change your own role');
  const ok = await setMembership(teamId, targetUserId, owner ? 'owner' : 'member');
  if (!ok) throw new HttpError(404, 'Member not found');
}

// Removes a member: anyone may leave; removing someone else needs a team manager.
export async function removeTeamMember(
  teamId: string,
  targetUserId: string,
  actor: AuthUser,
): Promise<void> {
  if (targetUserId !== actor.id) await assertTeamAccess(teamId, actor, 'manage');
  if (!(await getMembership(teamId, targetUserId))) throw new HttpError(404, 'Member not found');
  await removeMember(teamId, targetUserId);
}
