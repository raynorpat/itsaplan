import { db, teamInvite, teamMember, team, user } from '@repo/db';
import { and, desc, eq, sql } from 'drizzle-orm';
import { HttpError, iso, pgErrorCode } from '../shared/lib';
import type { MemberRole } from '../members/store';

// Data access for team invites. An invite is a token-addressed grant of a
// role to an email in a team. Creating one requires the team owner;
// accepting it (email must match the session) creates the team_member row.

export type InviteStatus = 'pending' | 'accepted' | 'rejected';

// Row shown to the owner managing invites. Includes the token so the owner can
// share the link, and who sent it.
export interface InviteRow {
  id: string;
  token: string;
  email: string;
  role: MemberRole;
  status: InviteStatus;
  createdAt: string;
  respondedAt: string | null;
  invitedByName: string | null;
  invitedByEmail: string | null;
}

// Row shown to the invitee opening the link, with enough team context to
// decide. Never exposes the internal team id.
export interface InviteView {
  token: string;
  teamKey: string;
  teamName: string;
  email: string;
  role: MemberRole;
  status: InviteStatus;
  createdAt: string;
  // Whether the invited email already has an account. Lets the accept screen
  // open in sign-in mode instead of registration. Scoped to the one email bound
  // to this (unguessable) token, so it is not a general existence oracle.
  hasAccount: boolean;
}

const normalizeEmail = (email: string) => email.trim().toLowerCase();

export async function createInvite(input: {
  teamId: string;
  email: string;
  role: MemberRole;
  invitedByUserId: string;
}): Promise<InviteRow> {
  const email = normalizeEmail(input.email);
  let row;
  try {
    [row] = await db
      .insert(teamInvite)
      .values({
        teamId: input.teamId,
        email,
        role: input.role,
        invitedByUserId: input.invitedByUserId,
      })
      .returning({ id: teamInvite.id });
  } catch (err) {
    if (pgErrorCode(err) === '23505') {
      throw new HttpError(409, 'A pending invite for this email already exists');
    }
    throw err;
  }
  return (await getInviteById(input.teamId, row.id))!;
}

export async function getInviteById(teamId: string, id: string): Promise<InviteRow | null> {
  const rows = await db
    .select({
      id: teamInvite.id,
      token: teamInvite.token,
      email: teamInvite.email,
      role: teamInvite.role,
      status: teamInvite.status,
      createdAt: teamInvite.createdAt,
      respondedAt: teamInvite.respondedAt,
      invitedByName: user.name,
      invitedByEmail: user.email,
    })
    .from(teamInvite)
    .leftJoin(user, eq(user.id, teamInvite.invitedByUserId))
    .where(and(eq(teamInvite.teamId, teamId), eq(teamInvite.id, id)));
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    token: r.token,
    email: r.email,
    role: r.role as MemberRole,
    status: r.status as InviteStatus,
    createdAt: iso(r.createdAt),
    respondedAt: r.respondedAt ? iso(r.respondedAt) : null,
    invitedByName: r.invitedByName,
    invitedByEmail: r.invitedByEmail,
  };
}

export async function listInvites(teamId: string): Promise<InviteRow[]> {
  const rows = await db
    .select({
      id: teamInvite.id,
      token: teamInvite.token,
      email: teamInvite.email,
      role: teamInvite.role,
      status: teamInvite.status,
      createdAt: teamInvite.createdAt,
      respondedAt: teamInvite.respondedAt,
      invitedByName: user.name,
      invitedByEmail: user.email,
    })
    .from(teamInvite)
    .leftJoin(user, eq(user.id, teamInvite.invitedByUserId))
    .where(eq(teamInvite.teamId, teamId))
    .orderBy(desc(teamInvite.createdAt));
  return rows.map((r) => ({
    id: r.id,
    token: r.token,
    email: r.email,
    role: r.role as MemberRole,
    status: r.status as InviteStatus,
    createdAt: iso(r.createdAt),
    respondedAt: r.respondedAt ? iso(r.respondedAt) : null,
    invitedByName: r.invitedByName,
    invitedByEmail: r.invitedByEmail,
  }));
}

// Removes an invite row. Returns true when one existed. Used to revoke a pending
// invite or clean up a resolved one.
export async function deleteInvite(teamId: string, id: string): Promise<boolean> {
  const deleted = await db
    .delete(teamInvite)
    .where(and(eq(teamInvite.teamId, teamId), eq(teamInvite.id, id)))
    .returning({ id: teamInvite.id });
  return deleted.length > 0;
}

// The invite behind a link, with its team context, or null if the token is
// unknown.
export async function getInviteByToken(token: string): Promise<InviteView | null> {
  const rows = await db
    .select({
      token: teamInvite.token,
      teamKey: team.key,
      teamName: team.name,
      email: teamInvite.email,
      role: teamInvite.role,
      status: teamInvite.status,
      createdAt: teamInvite.createdAt,
    })
    .from(teamInvite)
    .innerJoin(team, eq(team.id, teamInvite.teamId))
    .where(eq(teamInvite.token, token));
  const r = rows[0];
  if (!r) return null;
  // The invite email is stored normalized (lowercase); compare case-insensitively
  // against the account email, which better-auth does not guarantee is lowercased.
  const account = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(sql`lower(${user.email})`, r.email))
    .limit(1);
  return {
    token: r.token,
    teamKey: r.teamKey,
    teamName: r.teamName,
    email: r.email,
    role: r.role as MemberRole,
    status: r.status as InviteStatus,
    createdAt: iso(r.createdAt),
    hasAccount: account.length > 0,
  };
}

// The raw invite fields needed to act on it (accept/reject/match email).
export async function getInviteRowByToken(token: string) {
  const rows = await db
    .select({
      id: teamInvite.id,
      teamId: teamInvite.teamId,
      email: teamInvite.email,
      role: teamInvite.role,
      status: teamInvite.status,
    })
    .from(teamInvite)
    .where(eq(teamInvite.token, token));
  return rows[0] ?? null;
}

// Accepts a pending invite: creates (or updates) the membership and marks the
// invite accepted, in one transaction. The caller has already checked the
// invite is pending and the session email matches.
export async function acceptInvite(
  invite: { id: string; teamId: string; role: string },
  userId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const owner = invite.role === 'owner';
    await tx
      .insert(teamMember)
      .values({ teamId: invite.teamId, userId, owner })
      .onConflictDoUpdate({ target: [teamMember.teamId, teamMember.userId], set: { owner } });
    await tx
      .update(teamInvite)
      .set({ status: 'accepted', acceptedByUserId: userId, respondedAt: new Date() })
      .where(eq(teamInvite.id, invite.id));
  });
}

export async function rejectInvite(inviteId: string): Promise<void> {
  await db
    .update(teamInvite)
    .set({ status: 'rejected', respondedAt: new Date() })
    .where(eq(teamInvite.id, inviteId));
}
