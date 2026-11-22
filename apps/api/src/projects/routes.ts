import { Elysia, t } from 'elysia';
import { PROJECT_STATUSES, type ProjectStatusType } from '@repo/db';
import { mcpTool } from '../mcp/generate';
import { noContent } from '../shared/http';
import { authContext } from '../shared/auth-context';
import { requireUser, type AuthUser, visibleTeamIdList, memberTeamIdList } from '../shared/access';
import { isMcpRequest } from '../shared/mcp-request';
import { getTeamByKey } from '../teams/store';
import { assertProjectAccess } from './access';
import { HttpError } from '../shared/lib';
import { ErrorResponse } from '../shared/responses';
import {
  listProjects,
  projectStatusCounts,
  getProject,
  createProject,
  setProjectTeams,
  setProjectArchived,
  listProjectStatuses,
  updateProject,
  deleteProject,
  projectRev,
} from './store';
import { listFeed } from './activity';
import { listMilestones } from './milestones';

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
// computed on the fly (onTrack/atRisk/offTrack, or null when there is nothing
// to judge).
const ProjectTeamResponse = t.Object({
  id: t.String({ format: 'uuid' }),
  key: t.String(),
  name: t.String(),
});

const ProjectResponse = t.Object({
  id: t.String({ format: 'uuid' }),
  teams: t.Array(ProjectTeamResponse),
  name: t.String(),
  description: t.String(),
  content: t.String(),
  color: t.Nullable(t.String()),
  icon: t.Nullable(t.String()),
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
  computedHealth: t.Nullable(t.String()),
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
  // Guard for routes that address a project by its id. Projects span teams, so
  // access is resolved through all of the project's teams (see access.ts) and the
  // result is injected as `access`. Set `project: true` in the route options.
  .macro({
    project(_enabled: boolean) {
      return {
        async resolve({
          params,
          user,
          request,
        }: {
          params: Record<string, unknown>;
          user?: AuthUser | null;
          request: Request;
        }) {
          const access = await assertProjectAccess(String(params.projectId), requireUser(user).id, {
            mcpOnly: isMcpRequest(request.headers),
          });
          return { access };
        },
      };
    },
  })

  .get(
    '/projects',
    async ({ user, query, request }) => {
      const readable = await visibleTeamIdList(requireUser(user).id, {
        mcpOnly: isMcpRequest(request.headers),
      });
      const teamId = query.teamKey ? await teamIdByKey(query.teamKey) : undefined;
      const statuses = query.status
        ? query.status
            .split(',')
            .map((s) => s.trim())
            .filter((s): s is ProjectStatusType => PROJECT_STATUS_TYPES.has(s))
        : undefined;
      const page = query.page ?? 1;
      const pageSize = query.pageSize ?? 25;
      const { items, total } = await listProjects(readable, {
        teamId,
        includeArchived: query.includeArchived === 'true',
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
      query: t.Object({
        teamKey: t.Optional(t.String({ description: 'Only projects of this team.' })),
        includeArchived: t.Optional(
          t.String({ description: "'true' to include archived projects." }),
        ),
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
        description:
          'List the projects you can see across your teams, filtered (optionally to one team), sorted and paged.',
        ...mcpTool('list_projects'),
      },
    },
  )

  .get(
    '/projects/counts',
    async ({ user, query, request }) => {
      const readable = await visibleTeamIdList(requireUser(user).id, {
        mcpOnly: isMcpRequest(request.headers),
      });
      const teamId = query.teamKey ? await teamIdByKey(query.teamKey) : undefined;
      return projectStatusCounts(readable, teamId);
    },
    {
      query: t.Object({ teamKey: t.Optional(t.String()) }),
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
        description: "Per-status counts of the visible projects, for the list's tabs.",
      },
    },
  )

  .post(
    '/projects',
    async ({ body, user, set, request }) => {
      const actor = requireUser(user).id;
      // The create permission is needed in every team listed.
      const creatable = await visibleTeamIdList(actor, {
        mcpOnly: isMcpRequest(request.headers),
      });
      if (!body.teamIds.every((t) => creatable.includes(t)))
        throw new HttpError(
          403,
          'You do not have permission to create projects in every team listed',
        );
      const { teamIds, ...input } = body;
      const created = await createProject(teamIds, input, actor);
      set.status = 201;
      return (await getProject(
        created.id,
        await visibleTeamIdList(actor, { mcpOnly: isMcpRequest(request.headers) }),
      ))!;
    },
    {
      body: t.Object({
        teamIds: t.Array(t.String({ format: 'uuid' }), {
          minItems: 1,
          description: 'The teams the project belongs to (at least one). From list_teams.',
        }),
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
      response: {
        201: ProjectResponse,
        400: ErrorResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: 'Create a project',
        description: 'Create a project in one or more teams.',
        ...mcpTool('create_project'),
      },
    },
  )

  .get(
    '/projects/:projectId',
    async ({ params, access }) => {
      const found = await getProject(params.projectId, access.readableTeamIds);
      if (!found) throw new HttpError(404, 'Project not found');
      return found;
    },
    {
      params: projectParams,
      project: true,
      response: {
        200: ProjectResponse,
        400: ErrorResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: 'Get a project',
        description: 'Get a project by its id (a UUID).',
        ...mcpTool('get_project'),
      },
    },
  )

  .patch(
    '/projects/:projectId',
    async ({ params, body, user, access }) => {
      const actorUserId = requireUser(user).id;
      const updated = await updateProject(params.projectId, body, actorUserId);
      if (!updated) throw new HttpError(404, 'Project not found');
      return (await getProject(params.projectId, access.readableTeamIds))!;
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
      project: true,
      response: {
        200: ProjectResponse,
        400: ErrorResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: 'Update a project',
        description: 'Update a project by its id (a UUID).',
        ...mcpTool('update_project'),
      },
    },
  )

  .put(
    '/projects/:projectId/teams',
    async ({ params, body, user, access, request }) => {
      const actor = requireUser(user).id;
      const mcpOnly = isMcpRequest(request.headers);
      const editable = await visibleTeamIdList(actor, { mcpOnly });
      await setProjectTeams(
        params.projectId,
        access.readableTeamIds,
        editable,
        body.teamIds,
        actor,
      );
      return (await getProject(params.projectId, await visibleTeamIdList(actor, { mcpOnly })))!;
    },
    {
      params: projectParams,
      body: t.Object({
        teamIds: t.Array(t.String({ format: 'uuid' }), {
          description:
            'The teams you can see that the project should belong to. Teams you cannot see are kept.',
        }),
      }),
      project: true,
      response: {
        200: ProjectResponse,
        400: ErrorResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
        409: ErrorResponse,
      },
      detail: {
        summary: "Set a project's teams",
        description:
          "Replace the project's teams (the ones you can see). A team with issues in the project cannot be removed, and the project keeps at least one team.",
        ...mcpTool('set_project_teams'),
      },
    },
  )

  .get('/projects/:projectId/milestones', async ({ params }) => listMilestones(params.projectId), {
    params: projectParams,
    project: true,
    response: {
      200: t.Array(
        t.Object({
          id: t.String({ format: 'uuid' }),
          projectId: t.String({ format: 'uuid' }),
          name: t.String(),
          description: t.String(),
          targetDate: t.Nullable(t.String()),
          sortOrder: t.Number(),
          archivedAt: t.Nullable(t.String()),
          createdAt: t.String(),
          updatedAt: t.String(),
        }),
      ),
      401: ErrorResponse,
      403: ErrorResponse,
      404: ErrorResponse,
    },
    detail: {
      summary: "List a project's milestones",
      description: 'Milestones are read-only over REST; create and edit them over GraphQL.',
      ...mcpTool('list_project_milestones'),
    },
  })

  .get('/project-statuses', () => listProjectStatuses(), {
    response: {
      200: t.Array(
        t.Object({
          id: t.String({ format: 'uuid' }),
          name: t.String(),
          type: t.String(),
          color: t.String(),
          position: t.Number(),
        }),
      ),
      401: ErrorResponse,
    },
    detail: {
      summary: 'List project statuses',
      description: 'The six project statuses, in lifecycle order.',
      ...mcpTool('list_project_statuses'),
    },
  })

  .post(
    '/projects/:projectId/archive',
    async ({ params, access, user }) => {
      await setProjectArchived(params.projectId, true, requireUser(user).id);
      return (await getProject(params.projectId, access.readableTeamIds))!;
    },
    {
      params: projectParams,
      project: true,
      response: {
        200: ProjectResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: 'Archive a project',
        description: 'Archive a project; it is hidden from lists unless includeArchived.',
        ...mcpTool('archive_project'),
      },
    },
  )

  .post(
    '/projects/:projectId/unarchive',
    async ({ params, access, user }) => {
      await setProjectArchived(params.projectId, false, requireUser(user).id);
      return (await getProject(params.projectId, access.readableTeamIds))!;
    },
    {
      params: projectParams,
      project: true,
      response: {
        200: ProjectResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: 'Unarchive a project',
        description: 'Restore an archived project.',
        ...mcpTool('unarchive_project'),
      },
    },
  )

  .delete(
    '/projects/:projectId',
    async ({ params, user }) => {
      await deleteProject(params.projectId, requireUser(user).id);
      return noContent();
    },
    {
      params: projectParams,
      project: true,
      response: {
        204: t.Void(),
        400: ErrorResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: 'Delete a project',
        description: 'Delete a project by its id (a UUID). Irreversible.',
        ...mcpTool('delete_project'),
      },
    },
  )

  .get(
    '/projects/:projectId/feed',
    async ({ params, query, user, request }) => {
      const limit = query.limit != null ? Number(query.limit) : 25;
      let before = null;
      if (query.cursor) {
        try {
          before = JSON.parse(query.cursor);
        } catch {
          // Ignore a malformed cursor and serve the first page.
        }
      }
      const issueTeamIds = await memberTeamIdList(requireUser(user).id, {
        mcpOnly: isMcpRequest(request.headers),
      });
      return listFeed(params.projectId, issueTeamIds, { before, limit });
    },
    {
      params: projectParams,
      query: t.Object({
        limit: t.Optional(t.String({ description: 'Max items per page (1-100). Default 25.' })),
        cursor: t.Optional(
          t.String({ description: 'nextCursor from the previous page, for paging.' }),
        ),
      }),
      project: true,
      response: {
        200: FeedPageResponse,
        400: ErrorResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: 'Get a project feed',
        description: "Get a project's activity feed by its id (a UUID).",
        ...mcpTool('list_project_activity'),
      },
    },
  )

  .get(
    '/projects/:projectId/rev',
    async ({ params }) => ({ rev: await projectRev(params.projectId) }),
    {
      params: projectParams,
      project: true,
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

// The id of a team by key, or a value no team has, so an unknown key lists nothing.
async function teamIdByKey(key: string): Promise<string> {
  return (await getTeamByKey(key.toUpperCase()))?.id ?? '00000000-0000-0000-0000-000000000000';
}
