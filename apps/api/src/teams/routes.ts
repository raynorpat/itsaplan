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
  ISSUE_TYPE_PRESET_KEYS,
} from './store';
import { copyTeam, COPY_INCLUDE_KEYS } from './copy';
import { listStates } from '../states/store';
import { listIssueTypes } from '../issue-types/store';
import { listLabels, listLabelGroups } from '../labels/store';
import { listCustomFields } from '../custom-fields/store';

const teamBody = t.Object({
  // Letters and digits, starting with a letter; stored uppercased. The key is the
  // prefix of issue identifiers ("MKT-42") and Linear's team key.
  key: t.String({ pattern: '^[A-Za-z][A-Za-z0-9]*$' }),
  name: t.String({ minLength: 1 }),
  description: t.Optional(t.String()),
});

// Create adds the issue-type preset: which set of types the new team starts with.
// Omitted → "general" (a single Task). Copy takes its types from the source team,
// so the preset applies to create only.
const createTeamBody = t.Composite([
  teamBody,
  t.Object({
    preset: t.Optional(
      t.Union(
        ISSUE_TYPE_PRESET_KEYS.map((k) => t.Literal(k)),
        { description: `Issue-type preset: ${ISSUE_TYPE_PRESET_KEYS.join(', ')}.` },
      ),
    ),
  }),
]);

// Copy adds an optional selection of which parts of the source team to carry over.
// Omitted → the source team's structure (states, types, labels, custom fields,
// views, dashboards, actions), matching the copy's original behavior. Each flag maps
// to a section of the team settings menu; the store force-enables dependencies.
const copyTeamBody = t.Composite([
  teamBody,
  t.Object({
    include: t.Optional(
      t.Object(Object.fromEntries(COPY_INCLUDE_KEYS.map((k) => [k, t.Optional(t.Boolean())]))),
    ),
  }),
]);

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
  dashboardsEnabled: t.Boolean(),
  notesEnabled: t.Boolean(),
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

// An issue type (IssueTypeRow from issue-types/store).
const IssueTypeResponse = t.Object({
  id: t.String({ format: 'uuid' }),
  teamId: t.String({ format: 'uuid' }),
  name: t.String(),
  icon: t.String(),
  color: t.String(),
  isDefault: t.Boolean(),
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

// An assignable candidate (AssigneeCandidate from members/store): a team
// member or an AI agent's bot user.
const AssigneeCandidateResponse = t.Object({
  userId: t.String({ format: 'uuid' }),
  name: t.String(),
  email: t.String(),
  image: t.Nullable(t.String()),
  kind: t.Union([t.Literal('member'), t.Literal('agent')]),
  agentKind: t.Nullable(t.Union([t.Literal('external'), t.Literal('internal')])),
});

// A custom field option (CustomFieldOptionRow from custom-fields/store).
const CustomFieldOptionResponse = t.Object({
  id: t.String({ format: 'uuid' }),
  value: t.String(),
  color: t.String(),
  position: t.Number(),
});

// A custom field (CustomFieldRow from custom-fields/store). The board carries every
// field of the team; the client filters by issueTypeId.
const CustomFieldResponse = t.Object({
  id: t.String({ format: 'uuid' }),
  issueTypeId: t.Nullable(t.String({ format: 'uuid' })),
  name: t.String(),
  fieldType: t.String(),
  showInBody: t.Boolean(),
  position: t.Number(),
  options: t.Array(CustomFieldOptionResponse),
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
  dashboards: t.Boolean(),
  notes: t.Boolean(),
});

// The team's settings: MCP reachability, the enabled sections and the
// auto-archive thresholds.
const TeamSettingsResponse = t.Object({
  mcpEnabled: t.Boolean(),
  features: FeaturesResponse,
  autoArchive: AutoArchiveResponse,
});

// The caller's own role in a team (from MemberContext in members/store). The
// resolved permission matrix is a sibling `permissions` key on the board payload.
const ViewerResponse = t.Object({
  role: t.Union([t.Literal('owner'), t.Literal('member')]),
});

// The team board scaffold (GET /teams/:teamKey): the team plus its
// columns, issue types, labels, label groups, assignable users, custom fields, and
// the caller's own effective access. The issues themselves come from
// GET /teams/:teamKey/issues/board.
const TeamBoardResponse = t.Object({
  team: TeamResponse,
  states: t.Array(WorkflowStateResponse),
  issueTypes: t.Array(IssueTypeResponse),
  labels: t.Array(LabelResponse),
  labelGroups: t.Array(LabelGroupResponse),
  assignees: t.Array(AssigneeCandidateResponse),
  customFields: t.Array(CustomFieldResponse),
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
      body: createTeamBody,
      response: {
        201: TeamResponse,
        400: ErrorResponse,
        401: ErrorResponse,
      },
      detail: {
        summary: 'Create a team',
        description:
          'Create a team you own. `key` is the unique, immutable prefix for issue ids ' +
          "(e.g. 'MKT' -> 'MKT-1'). Seeds the default columns and the issue types of the " +
          'chosen `preset`.',
        ...mcpTool('create_team'),
      },
    },
  )

  // Creates a new team copying the selected parts of the source team's
  // configuration (states, issue types, labels, custom fields, views, dashboards,
  // actions, roles, settings, notification providers, webhooks, integrations, tools,
  // skills, agents, schedules) but none of its issues. `include` picks the sections;
  // omitted, the team structure is copied as before.
  .post(
    '/teams/:teamKey/copy',
    async ({ team, body, user, set }) => {
      const { include, ...meta } = body;
      try {
        set.status = 201;
        return await copyTeam(team.id, meta, requireUser(user).id, include);
      } catch (err) {
        // Return the real cause in the body so the UI shows the actual error.
        console.error('copyTeam failed:', err);
        set.status = 400;
        return { error: err instanceof Error ? err.message : 'Failed to copy team' };
      }
    },
    {
      body: copyTeamBody,
      permission: ['work_items', 'read'],
      response: {
        201: TeamResponse,
        400: ErrorResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: 'Copy a team',
        description:
          "Copy a team's configuration into a new team you own, without its issues. " +
          'By default the structure (states, issue types, labels, custom fields, views, ' +
          'dashboards, actions) is copied. Pass `include` to choose sections; the API ' +
          'force-enables dependencies (e.g. a view pulls in the states it references).',
        ...mcpTool('copy_team'),
      },
    },
  )

  // Full team view: columns, issue types, labels, issues, and the caller's own
  // effective access (role + resolved permission matrix) — everything the work
  // items UI needs in one call. Assignee options come from the team's members
  // and AI agents, fetched separately. The web app gates its UI off `viewer`; the
  // API still enforces the same matrix on every request.
  .get(
    '/teams/:teamKey',
    async ({ team, user }) => {
      const [states, issueTypes, labels, labelGroups, assignees, customFields, viewer] =
        await Promise.all([
          listStates(team.id),
          listIssueTypes(team.id),
          listLabels(team.id),
          listLabelGroups(team.id),
          listAssigneeCandidates(team.id),
          listCustomFields(team.id, { allTypes: true }),
          getMemberContext(team.id, requireUser(user).id),
        ]);
      // The permission guard already asserted membership, so a context always
      // exists here; guard against a race (membership revoked mid-request).
      if (!viewer) throw new HttpError(403, 'You do not have access to this team');
      return {
        team,
        states,
        issueTypes,
        labels,
        labelGroups,
        assignees,
        customFields,
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
  // optional sections (projects, dashboards, notes) on or off. autoArchive sets
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
      return { mcpEnabled: current.mcpEnabled, features: teamFeatures(current), autoArchive };
    },
    {
      body: t.Object({
        mcpEnabled: t.Optional(t.Boolean()),
        features: t.Optional(
          t.Object({
            projects: t.Optional(t.Boolean()),
            dashboards: t.Optional(t.Boolean()),
            notes: t.Optional(t.Boolean()),
          }),
        ),
        autoArchive: t.Optional(
          t.Object({
            completedDays: t.Nullable(t.Integer({ minimum: 1 })),
            canceledDays: t.Nullable(t.Integer({ minimum: 1 })),
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
