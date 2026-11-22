import { db, team } from '@repo/db';
import { eq } from 'drizzle-orm';
import { HttpError } from '../shared/lib';
import {
  assertMcpEnabled,
  assertTeamWebhookAccess,
  atLeast,
  requireUser,
  workspaceRole,
  type AuthUser,
} from '../shared/access';
import { getTeamById } from '../teams/store';
import { getWebhook, type WebhookRow } from './store';

// All-teams webhooks are managed by workspace admins and owners (Linear); they
// receive the events of public teams.
export async function canManageAllTeams(user: { id: string }): Promise<boolean> {
  return atLeast(await workspaceRole(user.id), 'admin');
}

// Over MCP every team must also have MCP enabled: an all-teams webhook sends the
// events of every team, including teams that keep MCP clients out.
export async function assertAllTeamsManager(
  user: { id: string },
  opts: { mcp?: boolean } = {},
): Promise<void> {
  if (!(await canManageAllTeams(user)))
    throw new HttpError(403, 'All-teams webhooks need a workspace admin');
  if (opts.mcp) {
    const closed = await db
      .select({ id: team.id })
      .from(team)
      .where(eq(team.mcpEnabled, false))
      .limit(1);
    if (closed.length)
      throw new HttpError(403, 'All-teams webhooks over MCP need MCP enabled on every team');
  }
}

// Access to a webhook addressed by id: a team webhook through its team (admins and
// owners who can see it, MCP gating when `mcp`), an all-teams webhook through the
// all-teams rule. 404 when it does not exist.
export async function assertWebhookAccess(
  webhookId: string,
  user: AuthUser | null | undefined,
  opts: { mcp?: boolean } = {},
): Promise<WebhookRow> {
  const found = await getWebhook(webhookId);
  if (!found) throw new HttpError(404, 'Webhook not found');
  if (found.teamId === null) {
    await assertAllTeamsManager(requireUser(user), opts);
  } else {
    await assertTeamWebhookAccess(found.teamId, user);
    if (opts.mcp) {
      const team = await getTeamById(found.teamId);
      if (team) assertMcpEnabled(team, true);
    }
  }
  return found;
}

// Delivery history of an all-teams webhook holds payloads from before an admin was
// limited to public teams, so only owners read it; a team webhook's history follows
// the webhook's own access (checked by the route guard).
export async function assertDeliveryHistoryAccess(
  webhookId: string,
  user: AuthUser,
): Promise<void> {
  const found = await getWebhook(webhookId);
  if (found && found.teamId === null && (await workspaceRole(user.id)) !== 'owner')
    throw new HttpError(
      403,
      'Only a workspace owner can read the delivery history of an all-teams webhook',
    );
}
