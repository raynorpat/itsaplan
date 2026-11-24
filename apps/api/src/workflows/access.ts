import { atLeast, canManageTeam, canSeeTeam, workspaceRole } from '../shared/access';
import { HttpError } from '../shared/lib';
import type { RuleFields } from './validate';

// Who may list and change a team's workflow rules. Anyone who can see the team lists
// them. Guests and app users (an app user reads as a guest) never change one. Workspace
// admins and owners change any rule. Otherwise the rule's edit access decides:
// `everyone` any non-guest who can see the team, `teamOwners` a team manager,
// `workspaceAdmins` nobody else, `owner` the rule's owner. Creating a rule, and
// changing a rule's edit access, needs a team manager. The owner is the rule's last
// author (validate.ts), never someone else's choice.

export async function assertSeesTeam(
  teamId: string,
  userId: string,
  notFound = 'Team not found',
): Promise<void> {
  if (!(await canSeeTeam(teamId, userId))) throw new HttpError(404, notFound);
}

async function nonGuestRole(userId: string) {
  const role = await workspaceRole(userId);
  if (role === 'guest') throw new HttpError(403, 'A guest cannot change workflows');
  return role;
}

export async function assertMayCreate(teamId: string, userId: string): Promise<void> {
  await nonGuestRole(userId);
  if (!(await canManageTeam(teamId, userId)))
    throw new HttpError(403, 'Only a team owner or a workspace admin can create workflows');
}

export async function assertMayManageAccess(teamId: string, userId: string): Promise<void> {
  if (!(await canManageTeam(teamId, userId)))
    throw new HttpError(
      403,
      "Only a team owner or a workspace admin can change a workflow's edit access",
    );
}

export async function assertMayEdit(
  rule: Pick<RuleFields, 'teamId' | 'editAccess' | 'ownerId'>,
  userId: string,
): Promise<void> {
  const role = await nonGuestRole(userId);
  if (atLeast(role, 'admin')) return;
  const allowed =
    rule.editAccess === 'everyone' ||
    (rule.editAccess === 'teamOwners' && (await canManageTeam(rule.teamId, userId))) ||
    (rule.editAccess === 'owner' && rule.ownerId === userId);
  if (!allowed) throw new HttpError(403, 'You cannot change this workflow');
}
