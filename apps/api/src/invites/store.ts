import { db, team, user, workspaceInvite } from '@repo/db';
import { and, desc, eq, gt, inArray, lte, sql } from 'drizzle-orm';
import { HttpError, iso, pgErrorCode } from '../shared/lib';

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

// What the invite link shows before the address has an account.
export interface InviteView {
  token: string;
  email: string;
  role: InviteRole;
  teamNames: string[];
  invitedByName: string | null;
  expiresAt: string;
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
  invitedByName: user.name,
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

// Pending invites, newest first. Expired ones are left out.
export async function listInvites(): Promise<InviteRow[]> {
  const rows = await db
    .select(columns)
    .from(workspaceInvite)
    .leftJoin(user, eq(user.id, workspaceInvite.invitedByUserId))
    .where(active)
    .orderBy(desc(workspaceInvite.createdAt));
  return rows.map(mapInvite);
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

// The invite behind a link, for the sign-up screen, or null when it is unknown or
// expired.
export async function getInviteByToken(token: string): Promise<InviteView | null> {
  const [row] = await db
    .select(columns)
    .from(workspaceInvite)
    .leftJoin(user, eq(user.id, workspaceInvite.invitedByUserId))
    .where(and(eq(workspaceInvite.token, token), active));
  if (!row) return null;
  const teams = row.teamIds.length
    ? await db.select({ name: team.name }).from(team).where(inArray(team.id, row.teamIds))
    : [];
  return {
    token: row.token,
    email: row.email,
    role: row.role as InviteRole,
    teamNames: teams.map((t) => t.name).sort(),
    invitedByName: row.invitedByName,
    expiresAt: iso(row.expiresAt),
  };
}
