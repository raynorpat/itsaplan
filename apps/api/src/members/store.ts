import { db, teamMember, user } from '@repo/db';
import { and, eq } from 'drizzle-orm';
import { iso } from '../shared/lib';

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
  // What this member does in the team, free text set by a manager. Empty when unset.
  description: string;
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
      owner: teamMember.owner,
      description: teamMember.description,
    })
    .from(teamMember)
    .innerJoin(user, eq(user.id, teamMember.userId))
    .where(eq(teamMember.teamId, teamId));
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
      description: teamMember.description,
      createdAt: teamMember.createdAt,
    })
    .from(teamMember)
    .innerJoin(user, eq(user.id, teamMember.userId))
    .where(eq(teamMember.teamId, teamId))
    .orderBy(teamMember.createdAt);
  return rows.map((r) => ({
    userId: r.userId,
    name: r.name,
    email: r.email,
    image: r.image,
    role: roleOf(r.owner),
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
