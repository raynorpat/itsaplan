import { db, oauthInstallation, team, teamMember, user as userTable } from '@repo/db';
import { APP_ROLE } from '@repo/auth';
import { and, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { HttpError } from './lib';
import { getTeamByKey, type TeamRow } from '../teams/store';
import { mayUseAdminRights } from './request-auth';

// Linear's access model, the one place access is decided.
//
// - Workspace roles on the user: owner, admin, member, guest. An OAuth application
//   installed with `actor=app` acts as an app user (role `app`, @repo/auth
//   oauth-install.ts), which has a guest's workspace rights and is never an admin.
// - Teams are public or private. Owners, admins and members see and work in every
//   public team and in the private teams they are members of; guests only in the
//   teams they are members of; an app user in the teams chosen at install (its team
//   memberships, plus every public team when the install includes them).
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
  // A missing user or a value that is not a workspace role (an app user's `app`) gets
  // the least access.
  const role = row?.role as WorkspaceRole | undefined;
  if (!role || !(WORKSPACE_ROLES as readonly string[]).includes(role)) return 'guest';
  // An OAuth token without the `admin` scope acts as a member, so every admin check
  // (they all read the role here) refuses it.
  if (atLeast(role, 'admin') && !mayUseAdminRights(userId)) return 'member';
  return role;
}

// The roles that see every public team.
export const NON_GUEST_ROLES: WorkspaceRole[] = ['owner', 'admin', 'member'];

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

// --- Teams ------------------------------------------------------------------------

// Whether the user is an application's app user.
export async function isAppUser(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ role: userTable.workspaceRole })
    .from(userTable)
    .where(eq(userTable.id, userId));
  return row?.role === APP_ROLE;
}

// SQL subquery: the user's id when they see every public team — an owner, admin or
// member, or an app user whose install includes the public teams.
export function seesPublicTeams(userId: string) {
  return db
    .select({ id: userTable.id })
    .from(userTable)
    .where(
      and(
        eq(userTable.id, userId),
        or(
          inArray(userTable.workspaceRole, NON_GUEST_ROLES),
          and(
            eq(userTable.workspaceRole, APP_ROLE),
            sql`EXISTS (${db
              .select({ one: sql`1` })
              .from(oauthInstallation)
              .where(
                and(
                  eq(oauthInstallation.appUserId, userId),
                  eq(oauthInstallation.publicTeams, true),
                  isNull(oauthInstallation.uninstalledAt),
                ),
              )})`,
          ),
        ),
      ),
    );
}

// SQL subquery of the ids of the app users whose install includes every public team.
export function publicTeamAppUserIds() {
  return db
    .select({ id: oauthInstallation.appUserId })
    .from(oauthInstallation)
    .where(and(eq(oauthInstallation.publicTeams, true), isNull(oauthInstallation.uninstalledAt)));
}

// SQL subquery of the ids of every app user, for keeping them out of member lists.
export function appUserIds() {
  return db
    .select({ id: userTable.id })
    .from(userTable)
    .where(eq(userTable.workspaceRole, APP_ROLE));
}

// SQL subquery of the ids of the app users a picker does not offer: those whose
// install granted neither `app:assignable` nor `app:mentionable`, or that are
// uninstalled.
export function unofferedAppUserIds() {
  return db
    .select({ id: userTable.id })
    .from(userTable)
    .where(
      and(
        eq(userTable.workspaceRole, APP_ROLE),
        sql`NOT EXISTS (${db
          .select({ one: sql`1` })
          .from(oauthInstallation)
          .where(
            and(
              eq(oauthInstallation.appUserId, userTable.id),
              isNull(oauthInstallation.uninstalledAt),
              sql`${oauthInstallation.scopes} && ARRAY['app:assignable', 'app:mentionable']::text[]`,
            ),
          )})`,
      ),
    );
}

// SQL subquery of the ids of the teams the user is a member of.
export function memberTeamIds(userId: string) {
  return db.select({ id: teamMember.teamId }).from(teamMember).where(eq(teamMember.userId, userId));
}

// SQL condition on `team`: the teams the user can see — their teams, plus every
// public team when they see public teams (seesPublicTeams).
function visibleTeamCondition(userId: string): SQL {
  return or(
    inArray(team.id, memberTeamIds(userId)),
    and(eq(team.visibility, 'public'), inArray(sql`${userId}::uuid`, seesPublicTeams(userId))),
  )!;
}

// SQL subquery of the ids of the teams the user can see. Every list and lookup of
// team-owned data filters through it.
export function visibleTeamIds(userId: string) {
  return db.select({ id: team.id }).from(team).where(visibleTeamCondition(userId));
}

// The teams the user can see, as ids.
export async function visibleTeamIdList(userId: string): Promise<string[]> {
  const rows = await db.select({ id: team.id }).from(team).where(visibleTeamCondition(userId));
  return rows.map((r) => r.id);
}

// The teams the user is a member of, as ids.
export async function memberTeamIdList(userId: string): Promise<string[]> {
  const rows = await db
    .select({ id: teamMember.teamId })
    .from(teamMember)
    .where(eq(teamMember.userId, userId));
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
// any member of a team without owners — never an app user. The caller has checked
// they can see it.
export async function canManageTeam(teamId: string, userId: string): Promise<boolean> {
  if (atLeast(await workspaceRole(userId), 'admin')) return true;
  if (await isAppUser(userId)) return false;
  const rows = await db
    .select({ userId: teamMember.userId, owner: teamMember.owner })
    .from(teamMember)
    .where(eq(teamMember.teamId, teamId));
  const me = rows.find((r) => r.userId === userId);
  if (!me) return false;
  return me.owner || !rows.some((r) => r.owner);
}

// What a request needs on a team: `see` to read or work in it, `manage` for its
// settings and members, `join` to become a member (anyone who can see it, and
// workspace admins and owners on a private team they are not in).
export type TeamLevel = 'see' | 'manage' | 'join';

// Asserts the user may act on the team at `level`: 404 when they cannot see it
// (`notFound` names what was addressed), 403 when they may not manage it.
export async function assertTeamAccess(
  teamId: string,
  user: AuthUser | undefined | null,
  level: TeamLevel,
  notFound = 'Team not found',
): Promise<AuthUser> {
  const current = requireUser(user);
  if (!(await canSeeTeam(teamId, current.id))) {
    const adminJoining = level === 'join' && atLeast(await workspaceRole(current.id), 'admin');
    if (!adminJoining) throw new HttpError(404, notFound);
  }
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
