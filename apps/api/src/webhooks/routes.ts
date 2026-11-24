import { Elysia, t } from 'elysia';
import { noContent } from '../shared/http';
import { guards } from '../shared/guards';
import { requireUser, type AuthUser } from '../shared/access';
import { assertAllTeamsManager, assertWebhookAccess } from './access';
import { validateWebhookUrl } from './url';
import { authContext } from '../shared/auth-context';
import { HttpError } from '../shared/lib';
import { ErrorResponse } from '../shared/responses';
import {
  WEBHOOK_RESOURCE_TYPES,
  listWebhooks,
  listAllTeamsWebhooks,
  createWebhook,
  updateWebhook,
  rotateWebhookSecret,
  deleteWebhook,
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

export const webhookRoutes = new Elysia({ name: 'webhooks', detail: { tags: ['Webhooks'] } })
  .use(authContext)
  .use(guards)
  // Guard for routes that address a webhook by its own id (no :teamKey in the
  // path). Set `webhook: "<action>"` in the route options.
  .macro({
    // Routes that address a webhook by its own id: `webhook: "<action>"`.
    webhook: (_enabled: boolean) => ({
      async resolve({
        params,
        user,
      }: {
        params: Record<string, unknown>;
        user?: AuthUser | null;
        request: Request;
      }) {
        await assertWebhookAccess(String(params.webhookId), user);
        return {};
      },
    }),
    // Workspace-level routes for all-teams webhooks.
    allTeamsManager: (enabled: boolean) => ({
      async resolve({ user }: { user?: AuthUser | null; request: Request }) {
        if (enabled) await assertAllTeamsManager(requireUser(user));
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
      teamWebhooks: true,
      response: {
        200: t.Array(WebhookResponse),
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
      },
      detail: { summary: "List a team's webhooks" },
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
      teamWebhooks: true,
      response: {
        201: WebhookResponse,
        400: ErrorResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
      },
      detail: { summary: 'Create a webhook' },
    },
  )

  .get('/webhooks', () => listAllTeamsWebhooks(), {
    allTeamsManager: true,
    response: { 200: t.Array(WebhookResponse), 401: ErrorResponse, 403: ErrorResponse },
    detail: {
      summary: 'List all-teams webhooks',
      description: 'List the webhooks that receive events of every team.',
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
      webhook: true,
      response: {
        200: WebhookResponse,
        400: ErrorResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
      },
      detail: { summary: "Rotate a webhook's secret" },
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
      webhook: true,
      response: {
        200: WebhookResponse,
        400: ErrorResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
      },
      detail: { summary: 'Update a webhook' },
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
      webhook: true,
      response: {
        204: t.Void(),
        400: ErrorResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
      },
      detail: { summary: 'Delete a webhook' },
    },
  );
