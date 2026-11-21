import { HttpError } from './lib';
import { getTeamByKey, type TeamRow } from '../teams/store';
import { getMembership, getMemberContext } from '../members/store';
import { hasPermission, type PermissionAction, type PermissionResource } from './permissions';

// The authenticated user carried on the request context. Populated by the
// session guard in planner.ts from the better-auth session. Access checks only
// need the id; role is the global better-auth role ("god" | "user") and is not
// used for team access (access is strictly by team membership).
export interface AuthUser {
  id: string;
  email?: string | null;
  role?: string | null;
}

// Asserts a session is present, returning the user. Handlers under the planner
// run behind the session guard, but the context type still allows an absent
// user (the public raw-attachment route has none), so this narrows it and
// throws 401 when called without a session.
export function requireUser(user: AuthUser | undefined | null): AuthUser {
  if (!user) throw new HttpError(401, 'Authentication required');
  return user;
}

// Asserts the session belongs to the instance owner ("god"), the role the first
// registered user gets. It gates instance-wide administration (god mode) only —
// team access stays strictly by membership, so this never bypasses a team
// permission check.
export function requireGod(user: AuthUser | undefined | null): AuthUser {
  const current = requireUser(user);
  if (current.role !== 'god') throw new HttpError(403, 'Instance administration is owner-only');
  return current;
}

// Resolves the :teamKey path param, throwing 404 for an unknown team.
async function requireTeam(teamKey: string): Promise<TeamRow> {
  const team = await getTeamByKey(teamKey);
  if (!team) throw new HttpError(404, `Team '${teamKey}' not found`);
  return team;
}

// Resolves the :teamKey path param to a team the user may access. Throws
// 404 for an unknown team and 403 when the user is not a member. Wrapped by
// the teamMember and teamOwner guards.
export async function requireTeamAccess(
  teamKey: string,
  user: AuthUser | undefined | null,
): Promise<TeamRow> {
  const current = requireUser(user);
  const team = await requireTeam(teamKey);
  const role = await getMembership(team.id, current.id);
  if (!role) throw new HttpError(403, 'You do not have access to this team');
  return team;
}

// Resolves the :teamKey path param to a team and asserts the user is an
// owner, in a single membership lookup. Wrapped by the teamOwner guard, used
// for role and member management. Throws 404 for an unknown team, and 403 for
// a non-member or a member who is not an owner.
export async function requireTeamOwner(
  teamKey: string,
  user: AuthUser | undefined | null,
): Promise<TeamRow> {
  const current = requireUser(user);
  const team = await requireTeam(teamKey);
  const role = await getMembership(team.id, current.id);
  if (!role) throw new HttpError(403, 'You do not have access to this team');
  if (role !== 'owner') throw new HttpError(403, 'Only a team owner can do this');
  return team;
}

// Denies an MCP tool call against a team that has MCP disabled. A no-op for
// normal web/API requests (isMcp false), so the per-team toggle only gates the
// MCP surface, not the UI. Called by the guards after the team is resolved.
export function assertMcpEnabled(team: TeamRow, isMcp: boolean): void {
  if (isMcp && !team.mcpEnabled) {
    throw new HttpError(403, 'MCP is disabled for this team');
  }
}

// Formats a resource key for an error message: "custom_fields" -> "custom fields".
function resourceLabel(resource: PermissionResource): string {
  return resource.replace(/_/g, ' ');
}

// Asserts the user is a member of the team and their role grants the given
// action on the given resource. Owners bypass the matrix (always allowed).
// Throws 403 for a non-member or a member whose role lacks the permission. The
// underlying permission check behind the permission guard and the feature-local
// entity guards.
export async function assertPermission(
  teamId: string,
  user: AuthUser | undefined | null,
  resource: PermissionResource,
  action: PermissionAction,
): Promise<void> {
  const current = requireUser(user);
  const ctx = await getMemberContext(teamId, current.id);
  if (!ctx) throw new HttpError(403, 'You do not have access to this team');
  if (ctx.role === 'owner') return;
  if (!hasPermission(ctx.permissions, resource, action)) {
    throw new HttpError(403, `You do not have permission to ${action} ${resourceLabel(resource)}`);
  }
}

// Resolves the :teamKey path param to a team and asserts the given
// permission in one step. Wrapped by the permission guard. Throws 404 for an
// unknown team and 403 when the permission is missing.
export async function requireTeamPermission(
  teamKey: string,
  user: AuthUser | undefined | null,
  resource: PermissionResource,
  action: PermissionAction,
): Promise<TeamRow> {
  const current = requireUser(user);
  const team = await requireTeam(teamKey);
  await assertPermission(team.id, current, resource, action);
  return team;
}
