import { db, initiative, team } from '@repo/db';
import { eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { HttpError } from '../shared/lib';
import type { PermissionAction } from '../shared/permissions';
import { getMembership } from '../members/store';
import { teamsGranting } from '../projects/access';
import { getInitiative, type InitiativeRow } from './store';

// Access to initiatives, derived from the `projects` permission resource. An
// initiative with a lead team is reached through that team only; one without a
// lead team (a workspace initiative) through any team. Seeing needs
// `projects.read`, every other action `projects.<action>`. Over MCP only teams with
// MCP enabled count.

type Opts = { mcpOnly?: boolean };

const reaches = (teamIds: string[], leadTeamId: string | null) =>
  leadTeamId ? teamIds.includes(leadTeamId) : teamIds.length > 0;

// SQL over `initiative`: the initiatives visible through these teams (the teams
// granting the viewer `projects.read`).
export function initiativesVisibleThrough(readableTeamIds: string[]): SQL {
  if (readableTeamIds.length === 0) return sql`false`;
  return or(isNull(initiative.leadTeamId), inArray(initiative.leadTeamId, readableTeamIds))!;
}

// SQL over `initiative`: the initiatives the user can see.
export async function visibleInitiativesSql(userId: string, opts: Opts = {}): Promise<SQL> {
  return initiativesVisibleThrough(await teamsGranting(userId, 'read', opts));
}

export async function canSeeInitiative(
  userId: string,
  leadTeamId: string | null,
): Promise<boolean> {
  return reaches(await teamsGranting(userId, 'read'), leadTeamId);
}

// The initiative when the user may perform `action` on it: 404 when it does not
// exist or is not visible, 403 when visible but the action is not granted.
export async function assertInitiativeAccess(
  id: string,
  userId: string,
  action: PermissionAction,
  opts: Opts = {},
): Promise<InitiativeRow> {
  const row = await getInitiative(id);
  if (!row || !reaches(await teamsGranting(userId, 'read', opts), row.leadTeamId))
    throw new HttpError(404, 'Initiative not found');
  if (action !== 'read' && !reaches(await teamsGranting(userId, action, opts), row.leadTeamId))
    throw new HttpError(403, `You do not have permission to ${action} this initiative`);
  return row;
}

export async function assertCanCreateInitiative(
  userId: string,
  leadTeamId: string | null,
  opts: Opts = {},
): Promise<void> {
  if (!reaches(await teamsGranting(userId, 'create', opts), leadTeamId))
    throw new HttpError(403, 'You do not have permission to create this initiative');
}

// Making a team the lead team needs membership in it; an unknown team is 404.
export async function assertLeadTeamMember(userId: string, leadTeamId: string): Promise<void> {
  const [found] = await db.select({ id: team.id }).from(team).where(eq(team.id, leadTeamId));
  if (!found) throw new HttpError(404, 'Team not found');
  if (!(await getMembership(leadTeamId, userId)))
    throw new HttpError(403, 'You are not a member of the lead team');
}
