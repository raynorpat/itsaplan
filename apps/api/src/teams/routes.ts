import { Elysia, t } from 'elysia';
import { mcpTool } from '../mcp/generate';
import { noContent } from '../shared/http';
import { HttpError } from '../shared/lib';
import { authContext } from '../shared/auth-context';
import { guards } from '../shared/guards';
import { requireUser } from '../shared/access';
import { isMcpRequest } from '../shared/mcp-request';
import { ErrorResponse } from '../shared/responses';
import { getMemberContext, listAssigneeCandidates } from '../members/store';
import {
  listTeams,
  createTeam,
  updateTeam,
  deleteTeam,
  setTeamMcpEnabled,
  teamFeatures,
  setTeamFeatures,
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
});

// A team DTO (TeamRow from the store).
const TeamResponse = t.Object({
  id: t.String({ format: 'uuid' }),
  key: t.String(),
  name: t.String(),
  description: t.String(),
  mcpEnabled: t.Boolean(),
  // The optional sections, toggled in Settings -> General. All on by default; a
  // disabled section is hidden in the web app and its rows are kept.
  projectsEnabled: t.Boolean(),
  createdAt: t.String(),
});

// The permission matrix as resolved for a member: for each resource, the
// create/edit/read/delete flags.
const PermissionMatrix = t.Record(t.String(), t.Record(t.String(), t.Boolean()));

// A team in the caller's list (TeamListItem): TeamRow plus the caller's
// own role in it, and the caller's permission matrix when requested with
// ?permissions=true.
const TeamListItemResponse = t.Composite([
  TeamResponse,
  t.Object({
    role: t.Union([t.Literal('owner'), t.Literal('member')]),
    permissions: t.Optional(PermissionMatrix),
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

// Which optional sections the team shows (TeamFeatures from the store).
const FeaturesResponse = t.Object({
  projects: t.Boolean(),
});

// The team's settings: MCP reachability, the enabled sections and the
// auto-archive thresholds.
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
  mcpEnabled: t.Boolean(),
  features: FeaturesResponse,
  autoArchive: AutoArchiveResponse,
  cycles: CycleSettingsResponse,
});

// The caller's own role in a team (from MemberContext in members/store). The
// resolved permission matrix is a sibling `permissions` key on the board payload.
const ViewerResponse = t.Object({
  role: t.Union([t.Literal('owner'), t.Literal('member')]),
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
  // The caller's resolved permission matrix (owners get every flag).
  permissions: PermissionMatrix,
});

export const teamRoutes = new Elysia({ name: 'teams', detail: { tags: ['Teams'] } })
  .use(authContext)
  .use(guards)
  .get(
    '/teams',
    ({ user, request, query }) =>
      listTeams(requireUser(user).id, {
        mcpOnly: isMcpRequest(request.headers),
        withPermissions: query.permissions === 'true',
      }),
    {
      query: t.Object({
        permissions: t.Optional(
          t.String({
            description: "'true' to include the caller's permission matrix per team.",
          }),
        ),
      }),
      response: {
        200: t.Array(TeamListItemResponse),
        401: ErrorResponse,
      },
      detail: {
        summary: 'List teams',
        description:
          'List the teams you are a member of. Pass permissions=true to include your ' +
          'permission matrix on each.',
        ...mcpTool('list_teams'),
      },
    },
  )

  .post(
    '/teams',
    async ({ body, user, set }) => {
      set.status = 201;
      return createTeam(body, requireUser(user).id);
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
  // effective access (role + resolved permission matrix) — everything the work
  // items UI needs in one call. Assignee options come from the team's members
  // and AI agents, fetched separately. The web app gates its UI off `viewer`; the
  // API still enforces the same matrix on every request.
  .get(
    '/teams/:teamKey',
    async ({ team, user }) => {
      const [states, labels, labelGroups, assignees, viewer] = await Promise.all([
        listStates(team.id),
        listLabels(team.id),
        listLabelGroups(team.id),
        listAssigneeCandidates(team.id),
        getMemberContext(team.id, requireUser(user).id),
      ]);
      // The permission guard already asserted membership, so a context always
      // exists here; guard against a race (membership revoked mid-request).
      if (!viewer) throw new HttpError(403, 'You do not have access to this team');
      return {
        team,
        states,
        labels,
        labelGroups,
        assignees,
        viewer: { role: viewer.role },
        permissions: viewer.permissions,
      };
    },
    {
      permission: ['work_items', 'read'],
      response: {
        200: TeamBoardResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: 'Get a team',
        description:
          'Get a team setup by key: states, issue types, labels, custom fields, and ' +
          'assignable users and agents. Resolves the ids create_issue and update_issue ' +
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
      }),
      teamOwner: true,
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

  // Reads the team's settings: whether it is reachable over MCP, which optional
  // sections are enabled, and the auto-archive thresholds (days of inactivity in a
  // completed/canceled column before the worker archives an issue; null = off).
  // Any member may read.
  .get(
    '/teams/:teamKey/settings',
    async ({ team }) => ({
      mcpEnabled: team.mcpEnabled,
      features: teamFeatures(team),
      autoArchive: await getAutoArchiveSettings(team.id),
      cycles: await teamCycleSettings(team.id),
    }),
    {
      teamMember: true,
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
  // change. mcpEnabled toggles MCP access to the team. features turns the
  // optional sections (projects) on or off. autoArchive sets
  // the day count per state group (positive integer) or disables it (null).
  // Owner-only. Not an MCP tool: it governs MCP access, so an agent must not
  // change it.
  .patch(
    '/teams/:teamKey/settings',
    async ({ team, body }) => {
      let current = team;
      if (body.mcpEnabled !== undefined) {
        const updated = await setTeamMcpEnabled(team.id, body.mcpEnabled);
        if (!updated) throw new HttpError(404, 'Team not found');
        current = updated;
      }
      if (body.features !== undefined) {
        const updated = await setTeamFeatures(team.id, body.features);
        if (!updated) throw new HttpError(404, 'Team not found');
        current = updated;
      }
      const autoArchive =
        body.autoArchive !== undefined
          ? await setAutoArchiveSettings(team.id, body.autoArchive)
          : await getAutoArchiveSettings(team.id);
      const cycles =
        body.cycles !== undefined
          ? await setTeamCycleSettings(team.id, body.cycles)
          : await teamCycleSettings(team.id);
      return {
        mcpEnabled: current.mcpEnabled,
        features: teamFeatures(current),
        autoArchive,
        cycles,
      };
    },
    {
      body: t.Object({
        mcpEnabled: t.Optional(t.Boolean()),
        features: t.Optional(
          t.Object({
            projects: t.Optional(t.Boolean()),
          }),
        ),
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
      teamOwner: true,
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
      permission: ['danger_zone', 'delete'],
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
