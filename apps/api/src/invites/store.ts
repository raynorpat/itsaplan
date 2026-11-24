import { db, user, workspaceInvite } from '@repo/db';
import { and, eq, gt, lte, sql } from 'drizzle-orm';
import {
  assertWorkspaceRole,
  atLeast,
  canSeeTeam,
  workspaceRole,
  type AuthUser,
} from '../shared/access';
import { HttpError, iso, pgErrorCode } from '../shared/lib';
import { assertAllowedTo } from '../organization/store';
import { shownNameSql } from '../shared/user-name';

// Workspace invites (Linear's organization invites). An invite gives an address the
// role it will have and the teams it will join; the better-auth user-create hook
// applies both when the address signs up and deletes the invite. An expired invite
// is ignored and replaced by a new one.

export type InviteRole = 'admin' | 'member' | 'guest';

export interface InviteRow {
  id: string;
  token: string;
  email: string;
  role: InviteRole;
  teamIds: string[];
  createdAt: string;
  expiresAt: string;
  invitedByUserId: string | null;
  invitedByName: string | null;
}

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

const columns = {
  id: workspaceInvite.id,
  token: workspaceInvite.token,
  email: workspaceInvite.email,
  role: workspaceInvite.role,
  teamIds: workspaceInvite.teamIds,
  createdAt: workspaceInvite.createdAt,
  expiresAt: workspaceInvite.expiresAt,
  invitedByUserId: workspaceInvite.invitedByUserId,
  invitedByName: shownNameSql,
};

function mapInvite(r: {
  id: string;
  token: string;
  email: string;
  role: string;
  teamIds: string[];
  createdAt: Date;
  expiresAt: Date;
  invitedByUserId: string | null;
  invitedByName: string | null;
}): InviteRow {
  return {
    ...r,
    role: r.role as InviteRole,
    createdAt: iso(r.createdAt),
    expiresAt: iso(r.expiresAt),
  };
}

const active = gt(workspaceInvite.expiresAt, sql`now()`);

export async function getInvite(id: string): Promise<InviteRow | null> {
  const [row] = await db
    .select(columns)
    .from(workspaceInvite)
    .leftJoin(user, eq(user.id, workspaceInvite.invitedByUserId))
    .where(eq(workspaceInvite.id, id));
  return row ? mapInvite(row) : null;
}

// Creates an invite. The caller checks the inviter's role and the teams. An address
// with an account is already in the workspace (400); a second pending invite for
// an address is 409; an expired one is replaced.
export async function createInvite(input: {
  email: string;
  role: InviteRole;
  teamIds: string[];
  invitedByUserId: string;
}): Promise<InviteRow> {
  const email = normalizeEmail(input.email);
  const [account] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(sql`lower(${user.email})`, email));
  if (account) throw new HttpError(400, 'This address already has an account in the workspace');
  await db
    .delete(workspaceInvite)
    .where(and(eq(workspaceInvite.email, email), lte(workspaceInvite.expiresAt, sql`now()`)));
  let row;
  try {
    [row] = await db
      .insert(workspaceInvite)
      .values({
        email,
        role: input.role,
        teamIds: [...new Set(input.teamIds)],
        invitedByUserId: input.invitedByUserId,
      })
      .returning({ id: workspaceInvite.id });
  } catch (err) {
    if (pgErrorCode(err) === '23505')
      throw new HttpError(409, 'A pending invite for this email already exists');
    throw err;
  }
  return (await getInvite(row!.id))!;
}

export async function deleteInvite(id: string): Promise<boolean> {
  const deleted = await db
    .delete(workspaceInvite)
    .where(eq(workspaceInvite.id, id))
    .returning({ id: workspaceInvite.id });
  return deleted.length > 0;
}

// What a pending, unexpired invite shows on Linear's organizationInviteDetails, by its
// secret token (the value in the invite link), or null. Leaves out the invite's
// teams, which may include private ones.
export async function getInviteDetailsByToken(token: string): Promise<{
  email: string;
  role: InviteRole;
  invitedByName: string | null;
  createdAt: string;
} | null> {
  const [row] = await db
    .select({
      email: workspaceInvite.email,
      role: workspaceInvite.role,
      createdAt: workspaceInvite.createdAt,
      invitedByName: shownNameSql,
    })
    .from(workspaceInvite)
    .leftJoin(user, eq(user.id, workspaceInvite.invitedByUserId))
    .where(and(eq(workspaceInvite.token, token), active));
  if (!row) return null;
  return {
    email: row.email,
    role: row.role as InviteRole,
    invitedByName: row.invitedByName,
    createdAt: iso(row.createdAt),
  };
}

// Linear's organizationInviteCreate / POST /invites: owners, admins and members
// invite, never above their own role, only to teams they can see.
export async function inviteToWorkspace(
  input: { email: string; role: InviteRole; teamIds?: string[] },
  actor: AuthUser,
): Promise<InviteRow> {
  const inviter = await assertAllowedTo(actor, 'invitations');
  if (!atLeast(await workspaceRole(inviter.id), input.role))
    throw new HttpError(403, 'You cannot invite someone above your own role');
  const teamIds = input.teamIds ?? [];
  for (const teamId of teamIds)
    if (!(await canSeeTeam(teamId, inviter.id))) throw new HttpError(404, 'Team not found');
  return createInvite({
    email: input.email,
    role: input.role,
    teamIds,
    invitedByUserId: inviter.id,
  });
}

// Revokes an invite: its sender, or an admin or owner.
export async function revokeInvite(id: string, actor: AuthUser): Promise<void> {
  const invite = await getInvite(id);
  if (!invite) throw new HttpError(404, 'Invite not found');
  if (invite.invitedByUserId !== actor.id) await assertWorkspaceRole(actor, 'admin');
  await deleteInvite(invite.id);
}
