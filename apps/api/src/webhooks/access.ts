import { db, team, teamMember } from '@repo/db';
import { and, eq } from 'drizzle-orm';
import { HttpError } from '../shared/lib';
import { assertMcpEnabled, assertPermission, requireUser, type AuthUser } from '../shared/access';
import type { PermissionAction } from '../shared/permissions';
import { getTeamById } from '../teams/store';
import { getWebhook, type WebhookRow } from './store';

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

// Over MCP every team must also have MCP enabled: an all-teams webhook sends the
// events of every team, including teams that keep MCP clients out.
export async function assertAllTeamsManager(
  user: { id: string; role?: string | null },
  opts: { mcp?: boolean } = {},
): Promise<void> {
  if (!(await canManageAllTeams(user)))
    throw new HttpError(
      403,
      'All-teams webhooks need the instance owner or an owner of every team',
    );
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

// Access to a webhook addressed by id: a team webhook through its team's
// `webhooks.<action>` permission (and MCP gating when `mcp`), an all-teams
// webhook through the all-teams rule. 404 when it does not exist.
export async function assertWebhookAccess(
  webhookId: string,
  user: AuthUser | null | undefined,
  action: PermissionAction,
  opts: { mcp?: boolean } = {},
): Promise<WebhookRow> {
  const found = await getWebhook(webhookId);
  if (!found) throw new HttpError(404, 'Webhook not found');
  if (found.teamId === null) {
    await assertAllTeamsManager(requireUser(user), opts);
  } else {
    await assertPermission(found.teamId, user, 'webhooks', action);
    if (opts.mcp) {
      const team = await getTeamById(found.teamId);
      if (team) assertMcpEnabled(team, true);
    }
  }
  return found;
}
