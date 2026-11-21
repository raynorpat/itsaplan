import { db, projectTeam, team, teamMember, teamRole } from '@repo/db';
import { eq, inArray } from 'drizzle-orm';
import { HttpError } from '../shared/lib';
import {
  defaultMemberPermissions,
  fullPermissions,
  hasPermission,
  normalizePermissions,
  type PermissionAction,
} from '../shared/permissions';

// Access to projects, which span teams. A user reaches a project through the teams
// they are a member of: the project is visible when one of its teams grants them
// `projects.read`, and an action is allowed when one of its teams grants that
// action (owners hold every permission). Over MCP only teams with MCP enabled
// count.

// The ids of the teams where the user holds `projects.<action>`.
export async function teamsGranting(
  userId: string,
  action: PermissionAction,
  opts: { mcpOnly?: boolean } = {},
): Promise<string[]> {
  const rows = await db
    .select({
      teamId: teamMember.teamId,
      role: teamMember.role,
      permissions: teamRole.permissions,
      mcpEnabled: team.mcpEnabled,
    })
    .from(teamMember)
    .innerJoin(team, eq(team.id, teamMember.teamId))
    .leftJoin(teamRole, eq(teamRole.id, teamMember.roleId))
    .where(eq(teamMember.userId, userId));
  return rows
    .filter((r) => !opts.mcpOnly || r.mcpEnabled)
    .filter((r) => {
      const permissions =
        r.role === 'owner'
          ? fullPermissions()
          : r.permissions
            ? normalizePermissions(r.permissions)
            : defaultMemberPermissions();
      return hasPermission(permissions, 'projects', action);
    })
    .map((r) => r.teamId);
}

// The ids of the teams a project belongs to (empty when it does not exist).
export async function projectTeamIds(projectId: string): Promise<string[]> {
  const rows = await db
    .select({ teamId: projectTeam.teamId })
    .from(projectTeam)
    .where(eq(projectTeam.projectId, projectId));
  return rows.map((r) => r.teamId);
}

// Subquery of the projects linked to any of the given teams.
export function projectsInTeams(teamIds: string[]) {
  return db
    .select({ id: projectTeam.projectId })
    .from(projectTeam)
    .where(
      inArray(
        projectTeam.teamId,
        teamIds.length ? teamIds : ['00000000-0000-0000-0000-000000000000'],
      ),
    );
}

export interface ProjectAccess {
  // Teams of the project the user can read (what they are shown).
  readableTeamIds: string[];
  // Teams of the project granting the requested action.
  grantingTeamIds: string[];
}

// Resolves the user's access to a project for `action`. A project the user cannot
// read is a 404, as if it did not exist; a readable project whose teams do not
// grant the action is a 403.
export async function assertProjectAccess(
  projectId: string,
  userId: string,
  action: PermissionAction,
  opts: { mcpOnly?: boolean } = {},
): Promise<ProjectAccess> {
  const teams = await projectTeamIds(projectId);
  const readable = new Set(await teamsGranting(userId, 'read', opts));
  const readableTeamIds = teams.filter((t) => readable.has(t));
  if (readableTeamIds.length === 0) throw new HttpError(404, 'Project not found');
  const granting =
    action === 'read' ? readable : new Set(await teamsGranting(userId, action, opts));
  const grantingTeamIds = teams.filter((t) => granting.has(t));
  if (grantingTeamIds.length === 0)
    throw new HttpError(403, `You do not have permission to ${action} this project`);
  return { readableTeamIds, grantingTeamIds };
}
