import { db, team, webhook, webhookDelivery } from '@repo/db';
import { and, desc, eq, inArray, or, type SQL } from 'drizzle-orm';
import { assertTeamWebhookAccess, visibleTeamIdList, workspaceRole } from '../../shared/access';
import { HttpError, UUID_RE } from '../../shared/lib';

import {
  assertAllTeamsManager,
  assertWebhookAccess,
  canManageAllTeams,
} from '../../webhooks/access';
import {
  WEBHOOK_RESOURCE_TYPES,
  createWebhook,
  deleteWebhook,
  mapWebhook,
  rotateWebhookSecret,
  updateWebhook,
  type WebhookResourceType,
  type WebhookRow,
} from '../../webhooks/store';
import { validateWebhookUrl } from '../../webhooks/url';
import type { GraphQLContext } from '../context';
import { paginate, type PageArgs } from '../connection';
import { gqlError } from '../errors';
import { userById } from './issue';
import { guard, lastSyncId, onlySupported } from './mutations';
import { toTeam } from './team';

// Linear's Webhook over the webhook table. Workspace admins and owners manage
// webhooks: a team webhook when they can see the team, an all-teams webhook always
// (webhooks/access.ts).

function toWebhook(row: WebhookRow) {
  return {
    id: row.id,
    url: row.url,
    label: row.label,
    enabled: row.enabled,
    secret: row.secret,
    resourceTypes: row.resourceTypes,
    allPublicTeams: row.allPublicTeams,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: null,
    // Read by the relation resolvers; not schema fields.
    teamId: row.teamId,
    creatorUserId: row.creatorUserId,
  };
}

type GraphQLWebhook = ReturnType<typeof toWebhook>;

// The teams whose webhooks the viewer may read.
async function readableTeams(ctx: GraphQLContext): Promise<string[]> {
  const out: string[] = [];
  for (const teamId of await visibleTeamIdList(ctx.user.id)) {
    const allowed = await assertTeamWebhookAccess(teamId, ctx.user).then(
      () => true,
      () => false,
    );
    if (allowed) out.push(teamId);
  }
  return out;
}

const emptyPageInfo = {
  hasNextPage: false,
  hasPreviousPage: false,
  startCursor: null,
  endCursor: null,
};

// The webhooks the viewer may read, narrowed by `where`.
async function visibleWebhooks(where: SQL | undefined, args: PageArgs, ctx: GraphQLContext) {
  const teams = await readableTeams(ctx);
  const scope = or(
    teams.length ? inArray(webhook.teamId, teams) : undefined,
    (await canManageAllTeams(ctx.user)) ? eq(webhook.allPublicTeams, true) : undefined,
  );
  if (!scope) return { nodes: [], edges: [], pageInfo: emptyPageInfo };
  return paginate(
    args,
    { id: webhook.id, createdAt: webhook.createdAt, updatedAt: webhook.updatedAt },
    and(scope, where),
    (w, order, limit) =>
      db
        .select()
        .from(webhook)
        .where(w)
        .orderBy(...order)
        .limit(limit),
    (row) => toWebhook(mapWebhook(row)),
  );
}

function assertResourceTypes(types: string[] | undefined) {
  if (types === undefined) return;
  if (types.length === 0)
    throw gqlError('INVALID_INPUT', 'input.resourceTypes needs at least one type');
  const unknown = types.find((t) => !(WEBHOOK_RESOURCE_TYPES as readonly string[]).includes(t));
  if (unknown) throw gqlError('INVALID_INPUT', `Resource type ${unknown} is not supported`);
}

// A webhook the viewer may act on, mapped from the access errors to Linear's codes
// (a webhook the viewer cannot read is not found).
async function webhookFor(id: string, ctx: GraphQLContext, action: 'read' | 'edit' | 'delete') {
  if (!UUID_RE.test(id)) throw gqlError('ENTITY_NOT_FOUND', `Webhook ${id} not found`);
  try {
    return await assertWebhookAccess(id, ctx.user);
  } catch (err) {
    if (action === 'read' && err instanceof HttpError)
      throw gqlError('ENTITY_NOT_FOUND', `Webhook ${id} not found`);
    throw err;
  }
}

type CreateInput = Record<string, unknown> & {
  url: string;
  resourceTypes: string[];
  teamId?: string | null;
  allPublicTeams?: boolean | null;
  label?: string | null;
  secret?: string | null;
  enabled?: boolean | null;
};

type UpdateInput = Record<string, unknown> & {
  url?: string;
  resourceTypes?: string[];
  label?: string | null;
  secret?: string | null;
  enabled?: boolean | null;
};

export const webhookResolvers = {
  Query: {
    webhooks: (_: unknown, args: PageArgs, ctx: GraphQLContext) =>
      visibleWebhooks(undefined, args, ctx),
    webhook: async (_: unknown, { id }: { id: string }, ctx: GraphQLContext) =>
      guard(async () => toWebhook(await webhookFor(id, ctx, 'read'))),
  },
  Team: {
    webhooks: (t: { id: string }, args: PageArgs, ctx: GraphQLContext) =>
      visibleWebhooks(eq(webhook.teamId, t.id), args, ctx),
  },
  Webhook: {
    team: async (w: GraphQLWebhook) => {
      if (!w.teamId) return null;
      const [row] = await db.select().from(team).where(eq(team.id, w.teamId));
      return row ? toTeam(row) : null;
    },
    creator: (w: GraphQLWebhook, _: unknown, ctx: GraphQLContext) =>
      userById(w.creatorUserId, ctx.user.id),
    // The webhook's recent failed deliveries, newest first. An all-teams webhook's
    // history is for owners only (webhooks/access.ts); others get an empty list.
    failures: async (w: GraphQLWebhook, _: unknown, ctx: GraphQLContext) => {
      if (!w.teamId && (await workspaceRole(ctx.user.id)) !== 'owner') return [];
      const rows = await db
        .select()
        .from(webhookDelivery)
        .where(and(eq(webhookDelivery.webhookId, w.id), eq(webhookDelivery.status, 'failed')))
        .orderBy(desc(webhookDelivery.createdAt))
        .limit(50);
      return rows.map((d) => ({
        id: d.id,
        createdAt: d.createdAt.toISOString(),
        executionId: d.eventId,
        httpStatus: d.responseStatus,
        responseOrError: d.responseBody ?? d.lastError,
        url: w.url,
        webhook: w,
      }));
    },
  },
  Mutation: {
    webhookCreate: (_: unknown, { input }: { input: CreateInput }, ctx: GraphQLContext) =>
      guard(async () => {
        onlySupported(
          input,
          ['url', 'resourceTypes', 'teamId', 'allPublicTeams', 'label', 'secret', 'enabled'],
          'input',
        );
        assertResourceTypes(input.resourceTypes);
        const allTeams = input.allPublicTeams === true;
        if (allTeams === !!input.teamId)
          throw gqlError(
            'INVALID_INPUT',
            'Set exactly one of input.teamId and input.allPublicTeams',
          );
        if (allTeams) await assertAllTeamsManager(ctx.user);
        else await assertTeamWebhookAccess(input.teamId!, ctx.user);
        const created = await createWebhook({
          teamId: allTeams ? null : input.teamId!,
          url: validateWebhookUrl(input.url),
          resourceTypes: input.resourceTypes as WebhookResourceType[],
          label: input.label,
          secret: input.secret ?? undefined,
          enabled: input.enabled ?? true,
          creatorUserId: ctx.user.id,
        });
        return { success: true, lastSyncId: lastSyncId(), webhook: toWebhook(created) };
      }),

    webhookUpdate: (
      _: unknown,
      { id, input }: { id: string; input: UpdateInput },
      ctx: GraphQLContext,
    ) =>
      guard(async () => {
        onlySupported(input, ['url', 'resourceTypes', 'label', 'secret', 'enabled'], 'input');
        assertResourceTypes(input.resourceTypes);
        await webhookFor(id, ctx, 'edit');
        const updated = await updateWebhook(id, {
          url: input.url !== undefined ? validateWebhookUrl(input.url) : undefined,
          resourceTypes: input.resourceTypes as WebhookResourceType[] | undefined,
          label: input.label,
          secret: input.secret ?? undefined,
          enabled: input.enabled ?? undefined,
        });
        return { success: true, lastSyncId: lastSyncId(), webhook: toWebhook(updated!) };
      }),

    webhookDelete: (_: unknown, { id }: { id: string }, ctx: GraphQLContext) =>
      guard(async () => {
        await webhookFor(id, ctx, 'delete');
        await deleteWebhook(id);
        return { success: true, lastSyncId: lastSyncId(), entityId: id };
      }),

    webhookRotateSecret: (_: unknown, { id }: { id: string }, ctx: GraphQLContext) =>
      guard(async () => {
        await webhookFor(id, ctx, 'edit');
        const rotated = await rotateWebhookSecret(id);
        return { success: true, lastSyncId: lastSyncId(), secret: rotated!.secret };
      }),
  },
};
