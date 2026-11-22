import { Elysia, t } from 'elysia';
import { noContent } from '../shared/http';
import { guards, entityGuard } from '../shared/guards';
import { authContext } from '../shared/auth-context';
import { HttpError } from '../shared/lib';
import { ErrorResponse } from '../shared/responses';
import { mcpTool } from '../mcp/generate';
import { listViews, createView, getView, updateView, deleteView } from './store';

const viewParams = t.Object({ viewId: t.String({ format: 'uuid' }) });

// A saved view DTO (ViewRow from the store). filters and display are jsonb blobs
// owned by the UI, returned as-is (t.Any()).
const ViewResponse = t.Object({
  id: t.String({ format: 'uuid' }),
  teamId: t.String({ format: 'uuid' }),
  name: t.String(),
  icon: t.Nullable(t.String()),
  filters: t.Any(),
  display: t.Any(),
  createdAt: t.String(),
});

export const viewRoutes = new Elysia({ name: 'views', detail: { tags: ['Views'] } })
  .use(authContext)
  .use(guards)
  // Guard for routes that address a view by its own id (no :teamKey in the
  // path). Set `savedView: "<action>"` in the route options.
  .macro({
    savedView: entityGuard(
      'View not found',
      async (p) => (await getView(p.viewId))?.teamId ?? null,
    ),
  })
  .get(
    '/teams/:teamKey/views',
    async ({ team }) => {
      return listViews(team.id);
    },
    {
      teamAccess: 'see',
      response: {
        200: t.Array(ViewResponse),
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: 'List saved views',
        description: "List a team's saved views.",
        ...mcpTool('list_views'),
      },
    },
  )

  .post(
    '/teams/:teamKey/views',
    async ({ team, body, set }) => {
      set.status = 201;
      return createView({ teamId: team.id, ...body });
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        icon: t.Optional(t.Nullable(t.String())),
        filters: t.Optional(t.Any()),
        display: t.Optional(t.Any()),
      }),
      teamAccess: 'see',
      response: {
        201: ViewResponse,
        400: ErrorResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: 'Create a saved view',
        description: 'Create a saved view in a team.',
        ...mcpTool('create_view'),
      },
    },
  )

  .patch(
    '/views/:viewId',
    async ({ params, body }) => {
      const view = await updateView(params.viewId, body);
      if (!view) throw new HttpError(404, 'View not found');
      return view;
    },
    {
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1 })),
        icon: t.Optional(t.Nullable(t.String())),
        filters: t.Optional(t.Any()),
        display: t.Optional(t.Any()),
      }),
      params: viewParams,
      savedView: 'see',
      response: {
        200: ViewResponse,
        400: ErrorResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: 'Update a saved view',
        description: 'Update an existing saved view.',
        ...mcpTool('update_view'),
      },
    },
  )

  .delete(
    '/views/:viewId',
    async ({ params }) => {
      await deleteView(params.viewId);
      return noContent();
    },
    {
      params: viewParams,
      savedView: 'see',
      response: {
        204: t.Void(),
        400: ErrorResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: 'Delete a saved view',
        description: 'Delete a saved view. Irreversible.',
        ...mcpTool('delete_view'),
      },
    },
  );
