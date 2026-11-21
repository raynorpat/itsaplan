import { Elysia, t } from 'elysia';
import { PROJECT_STATUSES, type ProjectStatusType } from '@repo/db';
import { mcpTool } from '../mcp/generate';
import { noContent } from '../shared/http';
import { guards, entityGuard } from '../shared/guards';
import { authContext } from '../shared/auth-context';
import { requireUser } from '../shared/access';
import { HttpError } from '../shared/lib';
import { ErrorResponse } from '../shared/responses';
import {
  listProjects,
  projectStatusCounts,
  getProject,
  getProjectTeamId,
  createProject,
  updateProject,
  deleteProject,
  projectRev,
} from './store';
import { listFeed } from './activity';

const projectParams = t.Object({ projectId: t.String({ format: 'uuid' }) });

// The project lifecycle enum, validated at the edge so an invalid value is a
// 400 (not a Postgres CHECK violation → 500). Mirrors the DB check constraint.
const PROJECT_STATUS_TYPES = new Set<string>(PROJECT_STATUSES.map((s) => s.type));

const ProjectStatus = t.Union([
  t.Literal('backlog'),
  t.Literal('planned'),
  t.Literal('started'),
  t.Literal('paused'),
  t.Literal('completed'),
  t.Literal('canceled'),
]);

// ProjectRow from the store. progress is derived issue counts; health is
// computed on the fly (on_track/at_risk/off_track, or null when there is nothing
// to judge).
const ProjectResponse = t.Object({
  id: t.String({ format: 'uuid' }),
  teamId: t.String({ format: 'uuid' }),
  name: t.String(),
  description: t.String(),
  content: t.String(),
  status: t.String(),
  statusId: t.String({ format: 'uuid' }),
  leadUserId: t.Nullable(t.String({ format: 'uuid' })),
  priority: t.Integer(),
  startDate: t.Nullable(t.String()),
  targetDate: t.Nullable(t.String()),
  sortOrder: t.Number(),
  slugId: t.String(),
  archivedAt: t.Nullable(t.String()),
  createdAt: t.String(),
  updatedAt: t.String(),
  labelIds: t.Array(t.String({ format: 'uuid' })),
  progress: t.Object({ completed: t.Number(), canceled: t.Number(), total: t.Number() }),
  health: t.Nullable(t.String()),
});

// ProjectFeedItemRow from activity.ts: one timeline entry, from the project
// itself (source 'project') or a linked issue (source 'issue').
const FeedItemResponse = t.Object({
  id: t.String({ format: 'uuid' }),
  source: t.String(),
  kind: t.String(),
  actorUserId: t.Nullable(t.String({ format: 'uuid' })),
  actorName: t.Nullable(t.String()),
  body: t.Nullable(t.String()),
  action: t.Nullable(t.String()),
  subject: t.Nullable(t.String()),
  fromText: t.Nullable(t.String()),
  toText: t.Nullable(t.String()),
  createdAt: t.String(),
  issueId: t.Nullable(t.String({ format: 'uuid' })),
  issueIdentifier: t.Nullable(t.String()),
});

const FeedPageResponse = t.Object({
  items: t.Array(FeedItemResponse),
  nextCursor: t.Nullable(t.Object({ ts: t.String(), id: t.String({ format: 'uuid' }) })),
});

export const projectRoutes = new Elysia({
  name: 'projects',
  detail: { tags: ['Projects'] },
})
  .use(authContext)
  .use(guards)
  // Guard for routes that address an project by its own id (no :teamKey in
  // the path). Set `project: "<action>"` in the route options.
  .macro({
    project: entityGuard('projects', 'Project not found', (p) => getProjectTeamId(p.projectId)),
  })

  .get(
    '/teams/:teamKey/projects',
    async ({ team, query }) => {
      const statuses = query.status
        ? query.status
            .split(',')
            .map((s) => s.trim())
            .filter((s): s is ProjectStatusType => PROJECT_STATUS_TYPES.has(s))
        : undefined;
      const page = query.page ?? 1;
      const pageSize = query.pageSize ?? 25;
      const { items, total } = await listProjects(team.id, {
        statuses,
        search: query.search,
        sort: query.sort,
        dir: query.dir,
        limit: pageSize,
        offset: (page - 1) * pageSize,
      });
      return { items, total, page, pageSize };
    },
    {
      params: t.Object({ teamKey: t.String() }),
      query: t.Object({
        status: t.Optional(
          t.String({
            description:
              'Filter by status type: a comma-separated subset of backlog,planned,started,paused,completed,canceled. Omit for all.',
          }),
        ),
        search: t.Optional(t.String({ description: 'Case-insensitive match on the name.' })),
        sort: t.Optional(
          t.Union(
            [t.Literal('name'), t.Literal('priority'), t.Literal('targetDate'), t.Literal('lead')],
            { description: 'Sort column. Omit for the manual sort order.' },
          ),
        ),
        dir: t.Optional(
          t.Union([t.Literal('asc'), t.Literal('desc')], {
            description: 'Sort direction. Default asc.',
          }),
        ),
        page: t.Optional(t.Numeric({ minimum: 1, description: '1-based page. Default 1.' })),
        pageSize: t.Optional(
          t.Numeric({
            minimum: 1,
            maximum: 100,
            description: 'Items per page (1-100). Default 25.',
          }),
        ),
      }),
      permission: ['projects', 'read'],
      response: {
        200: t.Object({
          items: t.Array(ProjectResponse),
          total: t.Number(),
          page: t.Number(),
          pageSize: t.Number(),
        }),
        400: ErrorResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: 'List projects',
        description: "List a team's projects, filtered, sorted and paged.",
        ...mcpTool('list_projects'),
      },
    },
  )

  .get('/teams/:teamKey/projects/counts', async ({ team }) => projectStatusCounts(team.id), {
    params: t.Object({ teamKey: t.String() }),
    permission: ['projects', 'read'],
    response: {
      200: t.Object({
        total: t.Number(),
        backlog: t.Number(),
        planned: t.Number(),
        started: t.Number(),
        paused: t.Number(),
        completed: t.Number(),
        canceled: t.Number(),
      }),
      400: ErrorResponse,
      401: ErrorResponse,
      403: ErrorResponse,
      404: ErrorResponse,
    },
    detail: {
      summary: 'Project status counts',
      description: "Per-status project counts for a team, for the list's tabs.",
    },
  })

  .post(
    '/teams/:teamKey/projects',
    async ({ team, body, user, set }) => {
      set.status = 201;
      return createProject(team.id, body, requireUser(user).id);
    },
    {
      params: t.Object({ teamKey: t.String() }),
      body: t.Object({
        name: t.String({ minLength: 1, description: 'Project name.' }),
        description: t.Optional(t.String({ description: 'Short plain-text summary.' })),
        content: t.Optional(t.String({ description: 'Markdown overview.' })),
        status: t.Optional(ProjectStatus),
        leadUserId: t.Optional(
          t.Nullable(
            t.String({ format: 'uuid', description: 'Lead user id (a team member), or null.' }),
          ),
        ),
        priority: t.Optional(
          t.Integer({
            minimum: 0,
            maximum: 4,
            description: '0 none, 1 urgent, 2 high, 3 medium, 4 low.',
          }),
        ),
        startDate: t.Optional(
          t.Nullable(t.String({ description: "Start date 'YYYY-MM-DD', or null." })),
        ),
        targetDate: t.Optional(
          t.Nullable(t.String({ description: "Target date 'YYYY-MM-DD', or null." })),
        ),
        labelIds: t.Optional(
          t.Array(t.String({ format: 'uuid' }), {
            description: 'Project label ids to attach. From list_project_labels.',
          }),
        ),
      }),
      permission: ['projects', 'create'],
      response: {
        201: ProjectResponse,
        400: ErrorResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: 'Create an project',
        description: 'Create an project in a team.',
        ...mcpTool('create_project'),
      },
    },
  )

  .get(
    '/projects/:projectId',
    async ({ params }) => {
      const found = await getProject(params.projectId);
      if (!found) throw new HttpError(404, 'Project not found');
      return found;
    },
    {
      params: projectParams,
      project: 'read',
      response: {
        200: ProjectResponse,
        400: ErrorResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: 'Get an project',
        description: 'Get an project by its id (a UUID).',
        ...mcpTool('get_project'),
      },
    },
  )

  .patch(
    '/projects/:projectId',
    async ({ params, body, user }) => {
      const actorUserId = requireUser(user).id;
      const updated = await updateProject(params.projectId, body, actorUserId);
      if (!updated) throw new HttpError(404, 'Project not found');
      return updated;
    },
    {
      params: projectParams,
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1, description: 'New name.' })),
        description: t.Optional(t.String({ description: 'Short plain-text summary.' })),
        content: t.Optional(t.String({ description: 'Markdown overview.' })),
        status: t.Optional(ProjectStatus),
        leadUserId: t.Optional(
          t.Nullable(
            t.String({ format: 'uuid', description: 'Lead user id (a team member), or null.' }),
          ),
        ),
        priority: t.Optional(
          t.Integer({
            minimum: 0,
            maximum: 4,
            description: '0 none, 1 urgent, 2 high, 3 medium, 4 low.',
          }),
        ),
        startDate: t.Optional(
          t.Nullable(t.String({ description: "Start date 'YYYY-MM-DD', or null." })),
        ),
        targetDate: t.Optional(
          t.Nullable(t.String({ description: "Target date 'YYYY-MM-DD', or null." })),
        ),
        labelIds: t.Optional(
          t.Array(t.String({ format: 'uuid' }), {
            description: "Replace the project's labels with these ids.",
          }),
        ),
      }),
      project: 'edit',
      response: {
        200: ProjectResponse,
        400: ErrorResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: 'Update an project',
        description: 'Update an project by its id (a UUID).',
        ...mcpTool('update_project'),
      },
    },
  )

  .delete(
    '/projects/:projectId',
    async ({ params }) => {
      await deleteProject(params.projectId);
      return noContent();
    },
    {
      params: projectParams,
      project: 'delete',
      response: {
        204: t.Void(),
        400: ErrorResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: 'Delete an project',
        description: 'Delete an project by its id (a UUID). Irreversible.',
        ...mcpTool('delete_project'),
      },
    },
  )

  .get(
    '/projects/:projectId/feed',
    async ({ params, query }) => {
      const limit = query.limit != null ? Number(query.limit) : 25;
      let before = null;
      if (query.cursor) {
        try {
          before = JSON.parse(query.cursor);
        } catch {
          // Ignore a malformed cursor and serve the first page.
        }
      }
      return listFeed(params.projectId, { before, limit });
    },
    {
      params: projectParams,
      query: t.Object({
        limit: t.Optional(t.String({ description: 'Max items per page (1-100). Default 25.' })),
        cursor: t.Optional(
          t.String({ description: 'nextCursor from the previous page, for paging.' }),
        ),
      }),
      project: 'read',
      response: {
        200: FeedPageResponse,
        400: ErrorResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: 'Get an project feed',
        description: "Get an project's activity feed by its id (a UUID).",
        ...mcpTool('list_project_activity'),
      },
    },
  )

  .get(
    '/projects/:projectId/rev',
    async ({ params }) => ({ rev: await projectRev(params.projectId) }),
    {
      params: projectParams,
      project: 'read',
      response: {
        200: t.Object({ rev: t.String() }),
        400: ErrorResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
      },
      detail: { summary: 'Get project revision' },
    },
  );
