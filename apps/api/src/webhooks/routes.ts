import { Elysia, t } from 'elysia';
import { noContent } from '../shared/http';
import { guards } from '../shared/guards';
import { requireUser, type AuthUser } from '../shared/access';
import { isMcpRequest } from '../shared/mcp-request';
import type { PermissionAction } from '../shared/permissions';
import { assertAllTeamsManager, assertWebhookAccess } from './access';
import { validateWebhookUrl } from './url';
import { authContext } from '../shared/auth-context';
import { HttpError } from '../shared/lib';
import { mcpTool } from '../mcp/generate';
import { ErrorResponse } from '../shared/responses';
import {
  WEBHOOK_RESOURCE_TYPES,
  listWebhooks,
  listAllTeamsWebhooks,
  createWebhook,
  updateWebhook,
  rotateWebhookSecret,
  deleteWebhook,
  listWebhookDeliveries,
} from './store';

const webhookParams = t.Object({ webhookId: t.String({ format: 'uuid' }) });

const resourceType = t.UnionEnum([...WEBHOOK_RESOURCE_TYPES]);
const resourceTypesSchema = t.Array(resourceType, { minItems: 1 });

// A webhook subscription DTO (WebhookRow from the store).
const WebhookResponse = t.Object({
  id: t.String({ format: 'uuid' }),
  teamId: t.Nullable(t.String({ format: 'uuid' })),
  allPublicTeams: t.Boolean(),
  url: t.String(),
  label: t.Nullable(t.String()),
  secret: t.String(),
  resourceTypes: t.Array(resourceType),
  enabled: t.Boolean(),
  creatorUserId: t.Nullable(t.String()),
  createdAt: t.String(),
  updatedAt: t.String(),
});

const createBody = t.Object({
  url: t.String({ minLength: 1 }),
  resourceTypes: resourceTypesSchema,
  label: t.Optional(t.Nullable(t.String())),
  enabled: t.Optional(t.Boolean()),
});

// A webhook delivery attempt DTO (WebhookDeliveryRow from the store).
const WebhookDeliveryResponse = t.Object({
  id: t.String({ format: 'uuid' }),
  eventId: t.String(),
  eventType: t.String(),
  status: t.String(),
  attempts: t.Number(),
  payload: t.Any(),
  responseStatus: t.Nullable(t.Number()),
  responseBody: t.Nullable(t.String()),
  lastError: t.Nullable(t.String()),
  nextAttemptAt: t.String(),
  createdAt: t.String(),
});

// One page of deliveries (WebhookDeliveryPage from the store).
const WebhookDeliveryPageResponse = t.Object({
  items: t.Array(WebhookDeliveryResponse),
  nextCursor: t.Nullable(t.String()),
});

export const webhookRoutes = new Elysia({ name: 'webhooks', detail: { tags: ['Webhooks'] } })
  .use(authContext)
  .use(guards)
  // Guard for routes that address a webhook by its own id (no :teamKey in the
  // path). Set `webhook: "<action>"` in the route options.
  .macro({
    // Routes that address a webhook by its own id: `webhook: "<action>"`.
    webhook: (action: PermissionAction) => ({
      async resolve({
        params,
        user,
        request,
      }: {
        params: Record<string, unknown>;
        user?: AuthUser | null;
        request: Request;
      }) {
        await assertWebhookAccess(String(params.webhookId), user, action, {
          mcp: isMcpRequest(request.headers),
        });
        return {};
      },
    }),
    // Workspace-level routes for all-teams webhooks.
    allTeamsManager: (enabled: boolean) => ({
      async resolve({ user, request }: { user?: AuthUser | null; request: Request }) {
        if (enabled)
          await assertAllTeamsManager(requireUser(user), { mcp: isMcpRequest(request.headers) });
        return {};
      },
    }),
  })
  .get(
    '/teams/:teamKey/webhooks',
    async ({ team }) => {
      return listWebhooks(team.id);
    },
    {
      permission: ['webhooks', 'read'],
      response: {
        200: t.Array(WebhookResponse),
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
      },
      detail: { summary: "List a team's webhooks", ...mcpTool('list_webhooks') },
    },
  )

  .post(
    '/teams/:teamKey/webhooks',
    async ({ team, body, set, user }) => {
      set.status = 201;
      return createWebhook({
        teamId: team.id,
        url: validateWebhookUrl(body.url),
        resourceTypes: body.resourceTypes,
        label: body.label,
        enabled: body.enabled,
        creatorUserId: requireUser(user).id,
      });
    },
    {
      body: createBody,
      permission: ['webhooks', 'create'],
      response: {
        201: WebhookResponse,
        400: ErrorResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
      },
      detail: { summary: 'Create a webhook', ...mcpTool('create_webhook') },
    },
  )

  .get('/webhooks', () => listAllTeamsWebhooks(), {
    allTeamsManager: true,
    response: { 200: t.Array(WebhookResponse), 401: ErrorResponse, 403: ErrorResponse },
    detail: {
      summary: 'List all-teams webhooks',
      description: 'List the webhooks that receive events of every team.',
      ...mcpTool('list_all_teams_webhooks'),
    },
  })

  .post(
    '/webhooks',
    async ({ body, set, user }) => {
      set.status = 201;
      return createWebhook({
        teamId: null,
        url: validateWebhookUrl(body.url),
        resourceTypes: body.resourceTypes,
        label: body.label,
        enabled: body.enabled,
        creatorUserId: requireUser(user).id,
      });
    },
    {
      body: createBody,
      allTeamsManager: true,
      response: {
        201: WebhookResponse,
        400: ErrorResponse,
        401: ErrorResponse,
        403: ErrorResponse,
      },
      detail: {
        summary: 'Create an all-teams webhook',
        description:
          'Create a webhook that receives events of every team, including teams created later.',
        ...mcpTool('create_all_teams_webhook'),
      },
    },
  )

  .post(
    '/webhooks/:webhookId/rotate-secret',
    async ({ params }) => {
      const updated = await rotateWebhookSecret(params.webhookId);
      if (!updated) throw new HttpError(404, 'Webhook not found');
      return updated;
    },
    {
      params: webhookParams,
      webhook: 'edit',
      response: {
        200: WebhookResponse,
        400: ErrorResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
      },
      detail: { summary: "Rotate a webhook's secret", ...mcpTool('rotate_webhook_secret') },
    },
  )

  .patch(
    '/webhooks/:webhookId',
    async ({ params, body }) => {
      const patch = {
        ...body,
        ...(body.url !== undefined ? { url: validateWebhookUrl(body.url) } : {}),
      };
      const updated = await updateWebhook(params.webhookId, patch);
      if (!updated) throw new HttpError(404, 'Webhook not found');
      return updated;
    },
    {
      body: t.Object({
        url: t.Optional(t.String({ minLength: 1 })),
        resourceTypes: t.Optional(resourceTypesSchema),
        label: t.Optional(t.Nullable(t.String())),
        enabled: t.Optional(t.Boolean()),
      }),
      params: webhookParams,
      webhook: 'edit',
      response: {
        200: WebhookResponse,
        400: ErrorResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
      },
      detail: { summary: 'Update a webhook', ...mcpTool('update_webhook') },
    },
  )

  .delete(
    '/webhooks/:webhookId',
    async ({ params }) => {
      await deleteWebhook(params.webhookId);
      return noContent();
    },
    {
      params: webhookParams,
      webhook: 'delete',
      response: {
        204: t.Void(),
        400: ErrorResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
      },
      detail: { summary: 'Delete a webhook', ...mcpTool('delete_webhook') },
    },
  )

  .get(
    '/webhooks/:webhookId/deliveries',
    async ({ params, query }) => {
      return listWebhookDeliveries(params.webhookId, { before: query.before, limit: query.limit });
    },
    {
      params: webhookParams,
      query: t.Object({
        before: t.Optional(t.String()),
        limit: t.Optional(t.Numeric()),
      }),
      webhook: 'read',
      response: {
        200: WebhookDeliveryPageResponse,
        400: ErrorResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: 'List webhook deliveries',
        description: "List a webhook's delivery attempts.",
        ...mcpTool('list_webhook_deliveries'),
      },
    },
  );
