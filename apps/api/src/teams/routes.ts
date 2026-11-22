import { Elysia, t } from 'elysia';
import { mcpTool } from '../mcp/generate';
import { noContent } from '../shared/http';
import { HttpError } from '../shared/lib';
import { authContext } from '../shared/auth-context';
import { guards } from '../shared/guards';
import { canManageTeam, requireUser, workspaceRole } from '../shared/access';
import { assertAllowedTo } from '../organization/store';
import { ErrorResponse } from '../shared/responses';
import { getMembership, listAssigneeCandidates } from '../members/store';
import {
  listTeams,
  createTeam,
  updateTeam,
  deleteTeam,
  getAutoArchiveSettings,
  setAutoArchiveSettings,
} from './store';
import { listStates } from '../states/store';
import { listLabels, listLabelGroups } from '../labels/store';
import { setTeamCycleSettings, teamCycleSettings } from '../cycles/store';

const teamBody = t.Object({
  // Letters and digits, starting with a letter; stored uppercased. The key is the
  // prefix of issue identifiers ("MKT-42") and Linear's team key.
  key: t.String({ pattern: '^[A-Za-z][A-Za-z0-9]*$' }),
  name: t.String({ minLength: 1 }),
  description: t.Optional(t.String()),
  visibility: t.Optional(t.UnionEnum(['public', 'private'])),
});

// A team DTO (TeamRow from the store).
const TeamResponse = t.Object({
  id: t.String({ format: 'uuid' }),
  key: t.String(),
  name: t.String(),
  description: t.String(),
  visibility: t.UnionEnum(['public', 'private']),
  createdAt: t.String(),
});

// A team in the caller's list (TeamListItem): TeamRow plus the caller's
// membership in it (null for a public team they have not joined) and whether they
// manage it.
const TeamListItemResponse = t.Composite([
  TeamResponse,
  t.Object({
    role: t.Nullable(t.Union([t.Literal('owner'), t.Literal('member')])),
    canManage: t.Boolean(),
  }),
]);

// A workflow state (WorkflowStateRow from states/store).
const WorkflowStateResponse = t.Object({
  id: t.String({ format: 'uuid' }),
  teamId: t.String({ format: 'uuid' }),
  name: t.String(),
  stateType: t.String(),
  color: t.String(),
  position: t.Number(),
});

// A label (LabelRow from labels/store).
const LabelResponse = t.Object({
  id: t.String({ format: 'uuid' }),
  // Null for a workspace label.
  teamId: t.Nullable(t.String({ format: 'uuid' })),
  groupId: t.Nullable(t.String({ format: 'uuid' })),
  name: t.String(),
  color: t.String(),
  retiredAt: t.Nullable(t.String()),
});

// A label group (LabelGroupRow from labels/store).
const LabelGroupResponse = t.Object({
  id: t.String({ format: 'uuid' }),
  teamId: t.Nullable(t.String({ format: 'uuid' })),
  name: t.String(),
  color: t.String(),
});

// An assignable candidate (AssigneeCandidate from members/store): a team member.
const AssigneeCandidateResponse = t.Object({
  userId: t.String({ format: 'uuid' }),
  name: t.String(),
  email: t.String(),
  image: t.Nullable(t.String()),
});

// Auto-archive thresholds (AutoArchiveSettings from the store): days of inactivity
// in a completed/canceled column before the worker archives an issue; null = off.
const AutoArchiveResponse = t.Object({
  completedDays: t.Nullable(t.Number()),
  canceledDays: t.Nullable(t.Number()),
});

// Cycle settings (TeamCycleSettings from cycles/store). Weeks for duration and
// cooldown; startDay is 0 = Sunday … 6 = Saturday.
const CycleSettingsResponse = t.Object({
  enabled: t.Boolean(),
  duration: t.Integer(),
  startDay: t.Integer(),
  cooldown: t.Integer(),
  upcoming: t.Integer(),
  autoAssignStarted: t.Boolean(),
  autoAssignCompleted: t.Boolean(),
});

const TeamSettingsResponse = t.Object({
  autoArchive: AutoArchiveResponse,
  cycles: CycleSettingsResponse,
});

// The caller's access to a team: their membership (null for a public team they
// have not joined), their workspace role, and whether they manage the team.
const ViewerResponse = t.Object({
  role: t.Nullable(t.Union([t.Literal('owner'), t.Literal('member')])),
  workspaceRole: t.UnionEnum(['owner', 'admin', 'member', 'guest']),
  canManage: t.Boolean(),
});

// The team board scaffold (GET /teams/:teamKey): the team plus its
// columns, labels, label groups, assignable users, and the caller's own effective
// access. The issues themselves come from
// GET /teams/:teamKey/issues/board.
const TeamBoardResponse = t.Object({
  team: TeamResponse,
  states: t.Array(WorkflowStateResponse),
  labels: t.Array(LabelResponse),
  labelGroups: t.Array(LabelGroupResponse),
  assignees: t.Array(AssigneeCandidateResponse),
  viewer: ViewerResponse,
});

export const teamRoutes = new Elysia({ name: 'teams', detail: { tags: ['Teams'] } })
  .use(authContext)
  .use(guards)
  .get('/teams', ({ user }) => listTeams(requireUser(user).id), {
    response: {
      200: t.Array(TeamListItemResponse),
      401: ErrorResponse,
    },
    detail: {
      summary: 'List teams',
      description:
        'List the teams you can see: your teams, plus every public team unless you are a ' +
        'guest. `role` is your membership (null when not joined).',
      ...mcpTool('list_teams'),
    },
  })

  .post(
    '/teams',
    async ({ body, user, set }) => {
      const current = await assertAllowedTo(user, 'teamCreation');
      set.status = 201;
      return createTeam(body, current.id);
    },
    {
      body: teamBody,
      response: {
        201: TeamResponse,
        400: ErrorResponse,
        401: ErrorResponse,
      },
      detail: {
        summary: 'Create a team',
        description:
          'Create a team you own. `key` is the unique, immutable prefix for issue ids ' +
          "(e.g. 'MKT' -> 'MKT-1'). Seeds the default columns.",
        ...mcpTool('create_team'),
      },
    },
  )

  // Full team view: columns, labels, issues, and the caller's own
  // access (`viewer`) — everything the work items UI needs in one call. Assignee
  // options come from the team's members. The web app gates its UI off `viewer`;
  // the API still enforces access on every request.
  .get(
    '/teams/:teamKey',
    async ({ team, user }) => {
      const userId = requireUser(user).id;
      const [states, labels, labelGroups, assignees, role, workspace, canManage] =
        await Promise.all([
          listStates(team.id),
          listLabels(team.id),
          listLabelGroups(team.id),
          listAssigneeCandidates(team.id),
          getMembership(team.id, userId),
          workspaceRole(userId),
          canManageTeam(team.id, userId),
        ]);
      return {
        team,
        states,
        labels,
        labelGroups,
        assignees,
        viewer: { role, workspaceRole: workspace, canManage },
      };
    },
    {
      teamAccess: 'see',
      response: {
        200: TeamBoardResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: 'Get a team',
        description:
          'Get a team setup by key: states, labels and assignable users. Resolves the ids ' +
          'create_issue and update_issue ' +
          'take. For issues use list_issues or search_issues.',
        ...mcpTool('get_team'),
      },
    },
  )

  // Updates a team's editable metadata (name, description). The key is the
  // immutable issue-identifier prefix and cannot change. Owner-only.
  .patch(
    '/teams/:teamKey',
    async ({ team, body }) => {
      const updated = await updateTeam(team.id, body);
      if (!updated) throw new HttpError(404, 'Team not found');
      return updated;
    },
    {
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1 })),
        description: t.Optional(t.String()),
        visibility: t.Optional(t.UnionEnum(['public', 'private'])),
      }),
      teamAccess: 'manage',
      response: {
        200: TeamResponse,
        400: ErrorResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: 'Update a team',
        description: "Update a team's name and/or description. The key is immutable.",
        ...mcpTool('update_team'),
      },
    },
  )

  // Reads the team's settings: the auto-archive thresholds (days of inactivity in a
  // completed/canceled column before the worker archives an issue; null = off).
  // Any member may read.
  .get(
    '/teams/:teamKey/settings',
    async ({ team }) => ({
      autoArchive: await getAutoArchiveSettings(team.id),
      cycles: await teamCycleSettings(team.id),
    }),
    {
      teamAccess: 'see',
      response: {
        200: TeamSettingsResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
      },
      detail: { summary: "Get a team's settings" },
    },
  )

  // Updates the team's settings. Each field is optional; only the supplied ones
  // change. autoArchive sets the day count per state group (positive integer) or
  // disables it (null). Team managers only.
  .patch(
    '/teams/:teamKey/settings',
    async ({ team, body }) => {
      const autoArchive =
        body.autoArchive !== undefined
          ? await setAutoArchiveSettings(team.id, body.autoArchive)
          : await getAutoArchiveSettings(team.id);
      const cycles =
        body.cycles !== undefined
          ? await setTeamCycleSettings(team.id, body.cycles)
          : await teamCycleSettings(team.id);
      return {
        autoArchive,
        cycles,
      };
    },
    {
      body: t.Object({
        autoArchive: t.Optional(
          t.Object({
            completedDays: t.Nullable(t.Integer({ minimum: 1 })),
            canceledDays: t.Nullable(t.Integer({ minimum: 1 })),
          }),
        ),
        // Ranges are checked by the store (400 with the allowed range).
        cycles: t.Optional(
          t.Object({
            enabled: t.Optional(t.Boolean()),
            duration: t.Optional(t.Integer()),
            startDay: t.Optional(t.Integer()),
            cooldown: t.Optional(t.Integer()),
            upcoming: t.Optional(t.Integer()),
            autoAssignStarted: t.Optional(t.Boolean()),
            autoAssignCompleted: t.Optional(t.Boolean()),
          }),
        ),
      }),
      teamAccess: 'manage',
      response: {
        200: TeamSettingsResponse,
        400: ErrorResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
      },
      detail: { summary: "Update a team's settings" },
    },
  )

  // Permanently removes the team and everything scoped to it. Irreversible.
  // Owner-only.
  .delete(
    '/teams/:teamKey',
    async ({ team }) => {
      await deleteTeam(team.id);
      return noContent();
    },
    {
      teamAccess: 'manage',
      response: {
        204: t.Void(),
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: 'Delete a team',
        description: 'Permanently delete a team and everything in it. Irreversible.',
        ...mcpTool('delete_team'),
      },
    },
  );
