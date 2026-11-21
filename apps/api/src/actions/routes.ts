import { Elysia, t } from 'elysia';
import { noContent } from '../shared/http';
import { guards, entityGuard } from '../shared/guards';
import { authContext } from '../shared/auth-context';
import { HttpError } from '../shared/lib';
import { mcpTool } from '../mcp/generate';
import { ErrorResponse } from '../shared/responses';
import {
  listActions,
  createAction,
  getAction,
  updateAction,
  deleteAction,
  reorderActions,
} from './store';

const actionParams = t.Object({ actionId: t.String({ format: 'uuid' }) });

// An action DTO (ActionRow from the store). condition and effect are jsonb blobs
// owned by the UI, stored and returned without inspecting their shape.
const ActionResponse = t.Object({
  id: t.String({ format: 'uuid' }),
  teamId: t.String({ format: 'uuid' }),
  name: t.String(),
  icon: t.String(),
  condition: t.Any(),
  effect: t.Any(),
  position: t.Number(),
  createdAt: t.String(),
});

export const actionRoutes = new Elysia({ name: 'actions', detail: { tags: ['Actions'] } })
  .use(authContext)
  .use(guards)
  // Guard for routes that address an action by its own id (no :teamKey in the
  // path). Set `savedAction: "<action>"` in the route options.
  .macro({
    savedAction: entityGuard(
      'actions',
      'Action not found',
      async (p) => (await getAction(p.actionId))?.teamId ?? null,
    ),
  })
  .get(
    '/teams/:teamKey/actions',
    async ({ team }) => {
      return listActions(team.id);
    },
    {
      permission: ['actions', 'read'],
      response: {
        200: t.Array(ActionResponse),
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: 'List actions',
        description: "List a team's actions.",
        ...mcpTool('list_actions'),
      },
    },
  )

  .post(
    '/teams/:teamKey/actions',
    async ({ team, body, set }) => {
      set.status = 201;
      return createAction({ teamId: team.id, ...body });
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        icon: t.Optional(t.String()),
        condition: t.Optional(t.Any()),
        effect: t.Optional(t.Any()),
      }),
      permission: ['actions', 'create'],
      response: {
        201: ActionResponse,
        400: ErrorResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: 'Create an action',
        description: 'Create an action in a team.',
        ...mcpTool('create_action'),
      },
    },
  )

  // Sets the action order to orderedIds.
  .put(
    '/teams/:teamKey/actions/reorder',
    async ({ team, body }) => {
      return reorderActions(team.id, body.orderedIds);
    },
    {
      body: t.Object({ orderedIds: t.Array(t.String({ format: 'uuid' }), { minItems: 1 }) }),
      permission: ['actions', 'edit'],
      response: {
        200: t.Array(ActionResponse),
        400: ErrorResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: 'Reorder actions',
        description: "Set the display order of a team's actions.",
        ...mcpTool('reorder_actions'),
      },
    },
  )

  .patch(
    '/actions/:actionId',
    async ({ params, body }) => {
      const action = await updateAction(params.actionId, body);
      if (!action) throw new HttpError(404, 'Action not found');
      return action;
    },
    {
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1 })),
        icon: t.Optional(t.String()),
        condition: t.Optional(t.Any()),
        effect: t.Optional(t.Any()),
      }),
      params: actionParams,
      savedAction: 'edit',
      response: {
        200: ActionResponse,
        400: ErrorResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: 'Update an action',
        description: 'Update an existing action.',
        ...mcpTool('update_action'),
      },
    },
  )

  .delete(
    '/actions/:actionId',
    async ({ params }) => {
      await deleteAction(params.actionId);
      return noContent();
    },
    {
      params: actionParams,
      savedAction: 'delete',
      response: {
        204: t.Void(),
        400: ErrorResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: 'Delete an action',
        description: 'Delete an action. Irreversible.',
        ...mcpTool('delete_action'),
      },
    },
  );
