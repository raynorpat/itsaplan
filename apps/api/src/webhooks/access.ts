import { db, team, teamMember } from '@repo/db';
import { and, eq } from 'drizzle-orm';
import { HttpError } from '../shared/lib';

// All-teams webhooks receive events of every team, so only the instance owner
// (the "god" user) or a user who is owner of every team may manage them. The rule
// is checked on every operation: a user who stops owning one team loses access.
export async function canManageAllTeams(user: {
  id: string;
  role?: string | null;
}): Promise<boolean> {
  if (user.role === 'god') return true;
  const teams = await db.select({ id: team.id }).from(team);
  if (teams.length === 0) return false;
  const owned = await db
    .select({ id: teamMember.teamId })
    .from(teamMember)
    .where(and(eq(teamMember.userId, user.id), eq(teamMember.role, 'owner')));
  const ownedIds = new Set(owned.map((r) => r.id));
  return teams.every((t) => ownedIds.has(t.id));
}

export async function assertAllTeamsManager(user: {
  id: string;
  role?: string | null;
}): Promise<void> {
  if (!(await canManageAllTeams(user)))
    throw new HttpError(
      403,
      'All-teams webhooks need the instance owner or an owner of every team',
    );
}
