import { randomUUID } from 'node:crypto';
import { db, team, user, webhook, webhookDelivery } from '@repo/db';
import { and, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import { getOrganization } from '../graphql/resolvers/organization';
import type { WebhookResourceType } from './store';

// Queues Linear-format webhook deliveries (https://linear.app/developers/webhooks).
// Called by the stores right after a change, with the entity's webhook data
// before and after it. One delivery row per matching webhook, all sharing one
// event id (sent as Linear-Delivery, stable across retries). The worker adds
// webhookTimestamp at send time and signs the body.

export type WebhookAction = 'create' | 'update' | 'remove';

type Data = Record<string, unknown>;

// Nested objects repeat the relation ids (teamId, stateId, …), so they stay out of
// the diff.
const NOT_DIFFED = new Set(['team', 'state', 'assignee', 'labels']);

// Linear's updatedFrom: the previous values of the fields that changed (a
// previously unset value is null), plus the previous updatedAt.
export function updatedFrom(before: Data, after: Data): Data {
  const out: Data = {};
  for (const key of Object.keys(after)) {
    if (key === 'updatedAt' || NOT_DIFFED.has(key)) continue;
    if (JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null))
      out[key] = before[key] ?? null;
  }
  out.updatedAt = before.updatedAt ?? null;
  return out;
}

async function actorFor(userId: string | null) {
  if (!userId) return null;
  const [row] = await db
    .select({ id: user.id, name: user.name, email: user.email })
    .from(user)
    .where(eq(user.id, userId));
  return row ? { id: row.id, type: 'user', name: row.name, email: row.email } : null;
}

// Whether all-teams webhooks receive an event of these teams: a workspace-level
// event (no teams), or one that touches at least one public team (Linear's
// `allPublicTeams`: private teams' events reach only their own team webhooks).
async function reachesAllTeams(teamIds: string[]): Promise<boolean> {
  if (teamIds.length === 0) return true;
  const [row] = await db
    .select({ id: team.id })
    .from(team)
    .where(and(inArray(team.id, teamIds), eq(team.visibility, 'public')))
    .limit(1);
  return !!row;
}

// The webhooks of OAuth applications that receive an event of these teams. An
// application installed with `actor=app` receives the events its app user can see:
// its member teams, plus every public team when the install includes them. One that
// people have only authorized as themselves (consents, no install) receives the
// public teams' events, like an all-teams webhook. An archived (disabled) or
// uninstalled application with no consents receives nothing.
function applicationReach(teamIds: string[], allTeams: boolean): SQL {
  const teamList = teamIds.length
    ? sql`tm.team_id IN (${sql.join(
        teamIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})`
    : sql`false`;
  return sql`(
    ${webhook.oauthClientId} IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM oauth_client c
      WHERE c.client_id = ${webhook.oauthClientId} AND c.disabled IS NOT TRUE
    )
    AND (
      EXISTS (
        SELECT 1 FROM oauth_installation i
        WHERE i.client_id = ${webhook.oauthClientId} AND i.uninstalled_at IS NULL
          AND (
            (i.public_teams AND ${allTeams})
            OR EXISTS (
              SELECT 1 FROM team_member tm WHERE tm.user_id = i.app_user_id AND ${teamList}
            )
          )
      )
      OR (
        ${allTeams}
        AND NOT EXISTS (
          SELECT 1 FROM oauth_installation i
          WHERE i.client_id = ${webhook.oauthClientId} AND i.uninstalled_at IS NULL
        )
        AND EXISTS (SELECT 1 FROM oauth_consent oc WHERE oc.client_id = ${webhook.oauthClientId})
      )
    )
  )`;
}

// The enabled webhooks that receive `type` events of these teams.
async function matchingWebhooks(
  type: WebhookResourceType,
  teamIds: string[],
  limit?: number,
): Promise<{ id: string }[]> {
  const allTeams = await reachesAllTeams(teamIds);
  const query = db
    .select({ id: webhook.id })
    .from(webhook)
    .where(
      and(
        eq(webhook.enabled, true),
        sql`${webhook.resourceTypes} @> ${JSON.stringify([type])}::jsonb`,
        or(
          allTeams ? eq(webhook.allPublicTeams, true) : undefined,
          teamIds.length ? inArray(webhook.teamId, teamIds) : undefined,
          applicationReach(teamIds, allTeams),
        ),
      ),
    );
  return limit ? query.limit(limit) : query;
}

// Whether any enabled webhook receives `type` events of these teams. Lets a caller
// skip building webhook data on an instance or team with no such webhook.
export async function isWatched(type: WebhookResourceType, teamIds: string[]): Promise<boolean> {
  return (await matchingWebhooks(type, teamIds, 1)).length > 0;
}

export async function emitEvent(input: {
  type: WebhookResourceType;
  action: WebhookAction;
  // The teams the entity belongs to; team webhooks of these teams match.
  teamIds: string[];
  actorUserId: string | null;
  data: Data;
  // The entity before the change, for an update.
  before?: Data;
}): Promise<void> {
  let changes: Data | undefined;
  if (input.action === 'update') {
    changes = updatedFrom(input.before ?? {}, input.data);
    if (Object.keys(changes).length <= 1) return; // only updatedAt
  }
  const matching = await matchingWebhooks(input.type, input.teamIds);
  if (matching.length === 0) return;

  const eventId = randomUUID();
  const base = {
    action: input.action,
    type: input.type,
    actor: await actorFor(input.actorUserId),
    createdAt: new Date().toISOString(),
    data: input.data,
    ...(changes ? { updatedFrom: changes } : {}),
    url: input.data.url,
    organizationId: (await getOrganization()).id,
  };
  await db.insert(webhookDelivery).values(
    matching.map((h) => ({
      webhookId: h.id,
      eventId,
      eventType: input.type,
      payload: { ...base, webhookId: h.id },
    })),
  );
}
