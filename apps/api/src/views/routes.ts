import { Elysia, t } from 'elysia';
import { noContent } from '../shared/http';
import { guards, entityGuard } from '../shared/guards';
import { authContext } from '../shared/auth-context';
import { HttpError } from '../shared/lib';
import { ErrorResponse } from '../shared/responses';
import { mcpTool } from '../mcp/generate';
import { requireUser } from '../shared/access';
import {
  listViews,
  createView,
  getView,
  updateView,
  deleteView,
  upsertViewPreferences,
  viewPreferencesFor,
  type ViewRow,
} from './store';

const viewParams = t.Object({ viewId: t.String({ format: 'uuid' }) });

// A saved view DTO. filterData is Linear's IssueFilter; display is the view's
// organization view preferences, owned by the UI and returned as-is (t.Any()).
const ViewResponse = t.Object({
  id: t.String({ format: 'uuid' }),
  teamId: t.String({ format: 'uuid' }),
  name: t.String(),
  icon: t.Nullable(t.String()),
  filterData: t.Any(),
  display: t.Any(),
  createdAt: t.String(),
});

async function viewDto(view: ViewRow) {
  const prefs = await viewPreferencesFor(view.id, 'organization');
  return {
    id: view.id,
    teamId: view.teamId,
    name: view.name,
    icon: view.icon,
    filterData: view.filterData,
    display: prefs?.preferences ?? {},
    createdAt: view.createdAt,
  };
}

// The display blob of a create or update goes to the view's organization view
// preferences.
async function saveDisplay(viewId: string, display: unknown) {
  if (display === undefined) return;
  await upsertViewPreferences({
    customViewId: viewId,
    type: 'organization',
    preferences: (display && typeof display === 'object' ? display : {}) as Record<string, unknown>,
  });
}

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
      return Promise.all((await listViews(team.id)).map(viewDto));
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
    async ({ team, body, set, user }) => {
      const { display, ...input } = body;
      const view = await createView(team.id, input, requireUser(user).id);
      await saveDisplay(view.id, display);
      set.status = 201;
      return viewDto(view);
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        icon: t.Optional(t.Nullable(t.String())),
        filterData: t.Optional(t.Any()),
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
    async ({ params, body, user }) => {
      const { display, ...patch } = body;
      const view = await updateView(params.viewId, patch, requireUser(user).id);
      if (!view) throw new HttpError(404, 'View not found');
      await saveDisplay(view.id, display);
      return viewDto(view);
    },
    {
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1 })),
        icon: t.Optional(t.Nullable(t.String())),
        filterData: t.Optional(t.Any()),
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
