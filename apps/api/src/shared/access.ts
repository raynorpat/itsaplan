import { db, team, teamMember, user as userTable } from '@repo/db';
import { and, eq, inArray, ne, or, sql, type SQL } from 'drizzle-orm';
import { HttpError } from './lib';
import { getTeamByKey, type TeamRow } from '../teams/store';

// Linear's access model, the one place access is decided.
//
// - Workspace roles on the user: owner, admin, member, guest.
// - Teams are public or private. Owners, admins and members see and work in every
//   public team and in the private teams they are members of; guests only in the
//   teams they are members of.
// - Team management (settings, states, team labels, members of the team,
//   visibility, deletion) needs a team owner or a workspace admin or owner; a team
//   without owners is managed by any of its members. A manager must be able to see
//   the team, so an admin joins a private team before managing it.
// - Workspace actions follow the role table in
//   docs/superpowers/specs/2026-11-22-linear-roles-design.md (assertWorkspaceRole).
//
// A team the user cannot see answers 404; a visible team without the needed right
// answers 403.

// The authenticated user carried on the request context, from the better-auth
// session. Access checks read the workspace role from the database, so a role
// change applies to sessions that already exist.
export interface AuthUser {
  id: string;
  email?: string | null;
}

export const WORKSPACE_ROLES = ['owner', 'admin', 'member', 'guest'] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

const RANK: Record<WorkspaceRole, number> = { guest: 0, member: 1, admin: 2, owner: 3 };

// Whether `role` is at least `minimum` (owner > admin > member > guest).
export function atLeast(role: WorkspaceRole, minimum: WorkspaceRole): boolean {
  return RANK[role] >= RANK[minimum];
}

// Asserts a session is present, returning the user. Handlers under the planner
// run behind the session guard, but the context type still allows an absent
// user (the public raw-attachment route has none), so this narrows it and
// throws 401 when called without a session.
export function requireUser(user: AuthUser | undefined | null): AuthUser {
  if (!user) throw new HttpError(401, 'Authentication required');
  return user;
}

export async function workspaceRole(userId: string): Promise<WorkspaceRole> {
  const [row] = await db
    .select({ role: userTable.workspaceRole })
    .from(userTable)
    .where(eq(userTable.id, userId));
  return (row?.role as WorkspaceRole | undefined) ?? 'guest';
}

export async function setWorkspaceRole(userId: string, role: WorkspaceRole): Promise<void> {
  await db.update(userTable).set({ workspaceRole: role }).where(eq(userTable.id, userId));
}

// Asserts the user's workspace role is at least `minimum` (403 otherwise).
export async function assertWorkspaceRole(
  user: AuthUser | undefined | null,
  minimum: WorkspaceRole,
): Promise<AuthUser> {
  const current = requireUser(user);
  if (!atLeast(await workspaceRole(current.id), minimum))
    throw new HttpError(403, `Only a workspace ${minimum} or above can do this`);
  return current;
}

// Owners and admins run instance administration (god mode).
export const requireWorkspaceAdmin = (user: AuthUser | undefined | null) =>
  assertWorkspaceRole(user, 'admin');

// --- Teams ------------------------------------------------------------------------

// SQL subquery of the ids of the teams the user is a member of.
export function memberTeamIds(userId: string) {
  return db.select({ id: teamMember.teamId }).from(teamMember).where(eq(teamMember.userId, userId));
}

// SQL condition on `team`: the teams the user can see — their teams, plus every
// public team unless they are a guest.
function visibleTeamCondition(userId: string): SQL {
  return or(
    inArray(team.id, memberTeamIds(userId)),
    and(
      eq(team.visibility, 'public'),
      inArray(
        sql`${userId}::uuid`,
        db
          .select({ id: userTable.id })
          .from(userTable)
          .where(and(eq(userTable.id, userId), ne(userTable.workspaceRole, 'guest'))),
      ),
    ),
  )!;
}

// SQL subquery of the ids of the teams the user can see. Every list and lookup of
// team-owned data filters through it.
export function visibleTeamIds(userId: string) {
  return db.select({ id: team.id }).from(team).where(visibleTeamCondition(userId));
}

// The teams the user can see, as ids. `mcpOnly` keeps the teams reachable over MCP.
export async function visibleTeamIdList(
  userId: string,
  opts: { mcpOnly?: boolean } = {},
): Promise<string[]> {
  const rows = await db
    .select({ id: team.id })
    .from(team)
    .where(
      opts.mcpOnly
        ? and(visibleTeamCondition(userId), eq(team.mcpEnabled, true))
        : visibleTeamCondition(userId),
    );
  return rows.map((r) => r.id);
}

// The teams the user is a member of, as ids. `mcpOnly` keeps the teams reachable
// over MCP.
export async function memberTeamIdList(
  userId: string,
  opts: { mcpOnly?: boolean } = {},
): Promise<string[]> {
  const rows = await db
    .select({ id: teamMember.teamId })
    .from(teamMember)
    .innerJoin(team, eq(team.id, teamMember.teamId))
    .where(
      opts.mcpOnly
        ? and(eq(teamMember.userId, userId), eq(team.mcpEnabled, true))
        : eq(teamMember.userId, userId),
    );
  return rows.map((r) => r.id);
}

export async function isTeamMember(teamId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ userId: teamMember.userId })
    .from(teamMember)
    .where(and(eq(teamMember.teamId, teamId), eq(teamMember.userId, userId)));
  return !!row;
}

export async function canSeeTeam(teamId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: team.id })
    .from(team)
    .where(and(eq(team.id, teamId), visibleTeamCondition(userId)));
  return !!row;
}

// Whether the user manages the team: a workspace admin or owner, a team owner, or
// any member of a team without owners. The caller has checked they can see it.
export async function canManageTeam(teamId: string, userId: string): Promise<boolean> {
  if (atLeast(await workspaceRole(userId), 'admin')) return true;
  const rows = await db
    .select({ userId: teamMember.userId, owner: teamMember.owner })
    .from(teamMember)
    .where(eq(teamMember.teamId, teamId));
  const me = rows.find((r) => r.userId === userId);
  if (!me) return false;
  return me.owner || !rows.some((r) => r.owner);
}

// What a request needs on a team: `see` to read or work in it, `manage` for its
// settings and members.
export type TeamLevel = 'see' | 'manage';

// Asserts the user may act on the team at `level`: 404 when they cannot see it
// (`notFound` names what was addressed), 403 when they may not manage it.
export async function assertTeamAccess(
  teamId: string,
  user: AuthUser | undefined | null,
  level: TeamLevel,
  notFound = 'Team not found',
): Promise<AuthUser> {
  const current = requireUser(user);
  if (!(await canSeeTeam(teamId, current.id))) throw new HttpError(404, notFound);
  if (level === 'manage' && !(await canManageTeam(teamId, current.id)))
    throw new HttpError(403, 'Only a team owner or a workspace admin can do this');
  return current;
}

// Resolves the :teamKey path param to a team the user may act on at `level`.
export async function requireTeamAccess(
  teamKey: string,
  user: AuthUser | undefined | null,
  level: TeamLevel,
): Promise<TeamRow> {
  const found = await getTeamByKey(teamKey);
  if (!found) throw new HttpError(404, `Team '${teamKey}' not found`);
  await assertTeamAccess(found.id, user, level, `Team '${teamKey}' not found`);
  return found;
}

// Webhooks of a team: workspace admins and owners who can see the team (an admin
// joins a private team first).
export async function assertTeamWebhookAccess(
  teamId: string,
  user: AuthUser | undefined | null,
): Promise<AuthUser> {
  const current = await assertTeamAccess(teamId, user, 'see');
  if (!atLeast(await workspaceRole(current.id), 'admin'))
    throw new HttpError(403, 'Only a workspace admin can manage webhooks');
  return current;
}

// Denies an MCP tool call against a team that has MCP disabled. A no-op for
// normal web/API requests (isMcp false), so the per-team toggle only gates the
// MCP surface, not the UI. Called by the guards after the team is resolved.
export function assertMcpEnabled(team: TeamRow, isMcp: boolean): void {
  if (isMcp && !team.mcpEnabled) {
    throw new HttpError(403, 'MCP is disabled for this team');
  }
}
