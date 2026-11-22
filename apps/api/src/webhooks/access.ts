import { HttpError } from '../shared/lib';
import {
  assertTeamWebhookAccess,
  atLeast,
  requireUser,
  workspaceRole,
  type AuthUser,
} from '../shared/access';
import { getWebhook, type WebhookRow } from './store';

// All-teams webhooks are managed by workspace admins and owners (Linear); they
// receive the events of public teams.
export async function canManageAllTeams(user: { id: string }): Promise<boolean> {
  return atLeast(await workspaceRole(user.id), 'admin');
}

export async function assertAllTeamsManager(user: { id: string }): Promise<void> {
  if (!(await canManageAllTeams(user)))
    throw new HttpError(403, 'All-teams webhooks need a workspace admin');
}

// Access to a webhook addressed by id: a team webhook through its team (admins and
// owners who can see it), an all-teams webhook through the all-teams rule. 404 when
// it does not exist.
export async function assertWebhookAccess(
  webhookId: string,
  user: AuthUser | null | undefined,
): Promise<WebhookRow> {
  const found = await getWebhook(webhookId);
  if (!found) throw new HttpError(404, 'Webhook not found');
  if (found.teamId === null) {
    await assertAllTeamsManager(requireUser(user));
  } else {
    await assertTeamWebhookAccess(found.teamId, user);
  }
  return found;
}
