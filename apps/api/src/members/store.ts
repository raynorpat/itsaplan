import { db, teamMember, teamRole, user } from '@repo/db';
import { and, eq, sql } from 'drizzle-orm';
import { iso } from '../shared/lib';
import {
  defaultMemberPermissions,
  fullPermissions,
  normalizePermissions,
  type Permissions,
} from '../shared/permissions';

// Data access for team membership: which users can reach a team and their
// role in it ("owner" or "member"). Access checks resolve the owning team of
// any entity and look for the current user here.

export type MemberRole = 'owner' | 'member';

export interface MemberRow {
  userId: string;
  name: string;
  email: string;
  image: string | null;
  role: MemberRole;
  // The custom role assigned to a member, or null. Owners bypass roles, so their
  // roleId is always null.
  roleId: string | null;
  roleName: string | null;
  // What this member does in the team, free text set by an owner. Empty when unset.
  description: string;
  createdAt: string;
}

// A member's effective access in a team: the owner/member flag plus the
// resolved permission matrix. Owners get the full matrix; a member resolves it
// from their assigned role, falling back to the default member matrix when no
// role is set.
export interface MemberContext {
  role: MemberRole;
  permissions: Permissions;
}

// The current user's role in a team, or null when they are not a member.
export async function getMembership(teamId: string, userId: string): Promise<MemberRole | null> {
  const rows = await db
    .select({ role: teamMember.role })
    .from(teamMember)
    .where(and(eq(teamMember.teamId, teamId), eq(teamMember.userId, userId)));
  return rows[0] ? (rows[0].role as MemberRole) : null;
}

// The current user's role and resolved permission matrix in a team, or null
// when they are not a member. This is the single lookup behind assertPermission.
export async function getMemberContext(
  teamId: string,
  userId: string,
): Promise<MemberContext | null> {
  const rows = await db
    .select({
      role: teamMember.role,
      permissions: teamRole.permissions,
    })
    .from(teamMember)
    .leftJoin(teamRole, eq(teamRole.id, teamMember.roleId))
    .where(and(eq(teamMember.teamId, teamId), eq(teamMember.userId, userId)));
  const r = rows[0];
  if (!r) return null;
  const role = r.role as MemberRole;
  if (role === 'owner') return { role, permissions: fullPermissions() };
  const permissions = r.permissions
    ? normalizePermissions(r.permissions)
    : defaultMemberPermissions();
  return { role, permissions };
}

// A team member an issue can be assigned to, with their owner/member flag and their
// team description.
export interface AssigneeCandidate {
  userId: string;
  name: string;
  email: string;
  image: string | null;
  role: MemberRole;
  description: string;
}

export async function listAssigneeCandidates(teamId: string): Promise<AssigneeCandidate[]> {
  const rows = await db
    .select({
      userId: teamMember.userId,
      name: user.name,
      email: user.email,
      image: user.image,
      role: teamMember.role,
      description: teamMember.description,
    })
    .from(teamMember)
    .innerJoin(user, eq(user.id, teamMember.userId))
    .where(eq(teamMember.teamId, teamId));
  return rows
    .map((r) => ({ ...r, role: r.role as MemberRole }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function listMembers(teamId: string): Promise<MemberRow[]> {
  const rows = await db
    .select({
      userId: teamMember.userId,
      name: user.name,
      email: user.email,
      image: user.image,
      role: teamMember.role,
      roleId: teamMember.roleId,
      roleName: teamRole.name,
      description: teamMember.description,
      createdAt: teamMember.createdAt,
    })
    .from(teamMember)
    .innerJoin(user, eq(user.id, teamMember.userId))
    .leftJoin(teamRole, eq(teamRole.id, teamMember.roleId))
    .where(eq(teamMember.teamId, teamId))
    .orderBy(teamMember.createdAt);
  return rows.map((r) => ({
    userId: r.userId,
    name: r.name,
    email: r.email,
    image: r.image,
    role: r.role as MemberRole,
    roleId: r.roleId,
    roleName: r.roleName,
    description: r.description,
    createdAt: iso(r.createdAt),
  }));
}

// Sets a member's team description (what they do). Returns false when the user is
// not a member of the team.
export async function setMemberDescription(
  teamId: string,
  userId: string,
  description: string,
): Promise<boolean> {
  const updated = await db
    .update(teamMember)
    .set({ description })
    .where(and(eq(teamMember.teamId, teamId), eq(teamMember.userId, userId)))
    .returning({ userId: teamMember.userId });
  return updated.length > 0;
}

// Adds a user to a team. Upserts the role when the user is already a member,
// so re-adding is idempotent and doubles as a role change.
export async function upsertMember(
  teamId: string,
  userId: string,
  role: MemberRole,
): Promise<void> {
  await db
    .insert(teamMember)
    .values({ teamId, userId, role })
    .onConflictDoUpdate({
      target: [teamMember.teamId, teamMember.userId],
      set: { role },
    });
}

// Sets a member's owner/member flag and custom role in one update. Promoting to
// owner clears the role (owners bypass roles), so callers pass roleId null there;
// a member keeps roleId (null falls back to the default role). Returns false when
// the user is not a member of the team.
export async function setMembership(
  teamId: string,
  userId: string,
  role: MemberRole,
  roleId: string | null,
): Promise<boolean> {
  const updated = await db
    .update(teamMember)
    .set({ role, roleId })
    .where(and(eq(teamMember.teamId, teamId), eq(teamMember.userId, userId)))
    .returning({ userId: teamMember.userId });
  return updated.length > 0;
}

export async function removeMember(teamId: string, userId: string): Promise<void> {
  await db
    .delete(teamMember)
    .where(and(eq(teamMember.teamId, teamId), eq(teamMember.userId, userId)));
}

export async function countOwners(teamId: string): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(teamMember)
    .where(and(eq(teamMember.teamId, teamId), eq(teamMember.role, 'owner')));
  return rows[0]?.count ?? 0;
}
