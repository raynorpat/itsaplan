import { initiative } from '@repo/db';
import { inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { HttpError } from '../shared/lib';
import { canSeeTeam, isAppUser, visibleTeamIdList, workspaceRole } from '../shared/access';

import { getInitiative, type InitiativeRow } from './store';

// Access to initiatives. An initiative with a lead team is reached through that
// team; one without a lead team (a workspace initiative) through any team the user
// can see. Guests reach no initiatives. Seeing an initiative allows changing it.

const reaches = (teamIds: string[], leadTeamId: string | null) =>
  leadTeamId ? teamIds.includes(leadTeamId) : teamIds.length > 0;

// SQL over `initiative`: the initiatives visible through these teams.
export function initiativesVisibleThrough(readableTeamIds: string[]): SQL {
  if (readableTeamIds.length === 0) return sql`false`;
  return or(isNull(initiative.leadTeamId), inArray(initiative.leadTeamId, readableTeamIds))!;
}

// Teams through the user reaches initiatives: none for a guest (Linear's
// guests have no initiatives), else the teams they can see. An app user, which has
// a guest's workspace rights, reaches them through its teams.
async function initiativeTeams(userId: string): Promise<string[]> {
  if ((await workspaceRole(userId)) === 'guest' && !(await isAppUser(userId))) return [];
  return visibleTeamIdList(userId);
}

// SQL over `initiative`: the initiatives the user can see.
export async function visibleInitiativesSql(userId: string): Promise<SQL> {
  return initiativesVisibleThrough(await initiativeTeams(userId));
}

export async function canSeeInitiative(
  userId: string,
  leadTeamId: string | null,
): Promise<boolean> {
  return reaches(await initiativeTeams(userId), leadTeamId);
}

// The initiative when the user can see it, and so read and change it (404
// otherwise).
export async function assertInitiativeAccess(id: string, userId: string): Promise<InitiativeRow> {
  const row = await getInitiative(id);
  if (!row || !reaches(await initiativeTeams(userId), row.leadTeamId))
    throw new HttpError(404, 'Initiative not found');
  return row;
}

export async function assertCanCreateInitiative(
  userId: string,
  leadTeamId: string | null,
): Promise<void> {
  if (!reaches(await initiativeTeams(userId), leadTeamId))
    throw new HttpError(403, 'You do not have permission to create this initiative');
}

// Making a team the lead team needs being able to see it; an unknown team, or one
// the user cannot see, is 404.
export async function assertLeadTeamMember(userId: string, leadTeamId: string): Promise<void> {
  if (!(await canSeeTeam(leadTeamId, userId))) throw new HttpError(404, 'Team not found');
}
