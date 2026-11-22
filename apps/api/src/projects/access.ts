import { db, projectTeam } from '@repo/db';
import { eq, inArray } from 'drizzle-orm';
import { HttpError } from '../shared/lib';
import { visibleTeamIdList } from '../shared/access';

// Access to projects, which span teams. A project is visible, and can be worked
// on, when the user can see one of its teams (shared/access.ts). Over MCP only
// teams with MCP enabled count.

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
  // Teams of the project the user can see (what they are shown).
  readableTeamIds: string[];
}

// Resolves the user's access to a project: a project none of whose teams the user
// can see is a 404, as if it did not exist.
export async function assertProjectAccess(
  projectId: string,
  userId: string,
  opts: { mcpOnly?: boolean } = {},
): Promise<ProjectAccess> {
  const teams = await projectTeamIds(projectId);
  const visible = new Set(await visibleTeamIdList(userId, opts));
  const readableTeamIds = teams.filter((t) => visible.has(t));
  if (readableTeamIds.length === 0) throw new HttpError(404, 'Project not found');
  return { readableTeamIds };
}
