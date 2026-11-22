import { Elysia, t } from 'elysia';
import { authContext } from '../shared/auth-context';
import { assertWorkspaceRole, requireWorkspaceAdmin } from '../shared/access';
import { HttpError } from '../shared/lib';
import { ErrorResponse } from '../shared/responses';
import { noContent } from '../shared/http';
import { deleteTeam } from '../teams/store';
import {
  deleteInstanceUser,
  getInstanceTeam,
  getInstanceUser,
  listInstanceTeams,
  listInstanceUsers,
  verifyInstanceUserEmail,
} from './store';
import { getHotkeySettings, setHotkeySettings, HotkeyCombosSchema } from '../settings/hotkeys';
import { getUpdateStatus, UpdateStatusSchema } from '../settings/updates';

// God mode: the instance's remaining administration (keyboard shortcuts, update
// status, the user and team directories) for workspace owners and admins. Sign-in,
// email, Google and upload settings are workspace settings (../organization) or
// environment variables.

// One account in the instance user directory.
const InstanceUserResponse = t.Object({
  id: t.String(),
  name: t.String(),
  email: t.String(),
  image: t.Nullable(t.String()),
  emailVerified: t.Boolean(),
  role: t.String(),
  providers: t.Array(t.String()),
  teamCount: t.Number(),
  lastSeenAt: t.Nullable(t.String()),
  createdAt: t.String(),
});

const InstanceUserDetailResponse = t.Composite([
  InstanceUserResponse,
  t.Object({
    teams: t.Array(
      t.Object({
        teamId: t.String({ format: 'uuid' }),
        teamKey: t.String(),
        teamName: t.String(),
        role: t.UnionEnum(['owner', 'member']),
        ownerCount: t.Number(),
        joinedAt: t.String(),
      }),
    ),
  }),
]);

// One team in the instance team directory, with what it holds counted across
// its dependent tables.
const InstanceTeamResponse = t.Object({
  id: t.String({ format: 'uuid' }),
  key: t.String(),
  name: t.String(),
  description: t.String(),
  mcpEnabled: t.Boolean(),
  memberCount: t.Number(),
  issueCount: t.Number(),
  archivedIssueCount: t.Number(),
  projectCount: t.Number(),
  viewCount: t.Number(),
  lastActivityAt: t.Nullable(t.String()),
  createdAt: t.String(),
});

const InstanceTeamDetailResponse = t.Composite([
  InstanceTeamResponse,
  t.Object({
    members: t.Array(
      t.Object({
        userId: t.String({ format: 'uuid' }),
        name: t.String(),
        email: t.String(),
        image: t.Nullable(t.String()),
        role: t.UnionEnum(['owner', 'member']),
        joinedAt: t.String(),
      }),
    ),
  }),
]);

export const godRoutes = new Elysia({ name: 'god', detail: { tags: ['God'] } })
  .use(authContext)
  // Every route in this plugin is instance administration, so the role check runs
  // once here instead of per route: workspace admins and owners.
  .onBeforeHandle(async ({ user }) => {
    await requireWorkspaceAdmin(user);
  })

  .get('/god/hotkey-settings', () => getHotkeySettings(), {
    response: { 200: HotkeyCombosSchema, 401: ErrorResponse, 403: ErrorResponse },
    detail: {
      summary: 'Get instance keyboard shortcuts',
      description:
        'Get the keyboard shortcut overrides that apply to everyone on this instance. A command left out uses the built-in binding.',
    },
  })

  .put('/god/hotkey-settings', ({ body }) => setHotkeySettings(body), {
    body: HotkeyCombosSchema,
    response: {
      200: HotkeyCombosSchema,
      400: ErrorResponse,
      401: ErrorResponse,
      403: ErrorResponse,
    },
    detail: {
      summary: 'Update instance keyboard shortcuts',
      description:
        'Replace the instance keyboard shortcut overrides. Each user may still rebind a shortcut for their own account.',
    },
  })

  // Whether a newer release is published, and the notes of the releases around the
  // running one. Owner-only: they are the one who upgrades the instance, and the
  // sidebar hides the indicator from everyone else. The version alone is readable by
  // any signed-in user (/settings/version).
  .get('/god/updates', () => getUpdateStatus(), {
    response: { 200: UpdateStatusSchema, 401: ErrorResponse, 403: ErrorResponse },
    detail: {
      summary: 'Get the update status',
      description:
        'Get the running version, the newest published one, and the release notes. The upstream check is cached for six hours.',
    },
  })

  .post('/god/updates/check', () => getUpdateStatus(true), {
    response: { 200: UpdateStatusSchema, 401: ErrorResponse, 403: ErrorResponse },
    detail: {
      summary: 'Check for updates now',
      description:
        'Read the published releases again, ignoring the cache. Returns the update status either way: a failed check answers from the previous result.',
    },
  })

  .get(
    '/god/users',
    ({ query }) =>
      listInstanceUsers({
        search: query.search,
        limit: query.limit ?? 50,
        offset: query.offset ?? 0,
      }),
    {
      query: t.Object({
        search: t.Optional(t.String()),
        limit: t.Optional(t.Numeric({ minimum: 1, maximum: 200 })),
        offset: t.Optional(t.Numeric({ minimum: 0 })),
      }),
      response: {
        200: t.Object({ items: t.Array(InstanceUserResponse), total: t.Number() }),
        400: ErrorResponse,
        401: ErrorResponse,
        403: ErrorResponse,
      },
      detail: {
        summary: 'List instance users',
        description:
          'List one page of accounts, with the global role and sign-in state of each, plus how many match the filters.',
      },
    },
  )

  .get(
    '/god/users/:userId',
    async ({ params }) => {
      const found = await getInstanceUser(params.userId);
      if (!found) throw new HttpError(404, 'User not found');
      return found;
    },
    {
      params: t.Object({ userId: t.String({ format: 'uuid' }) }),
      response: {
        200: InstanceUserDetailResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: 'Get an instance user',
        description: 'Get one account with the teams it belongs to.',
      },
    },
  )

  .post(
    '/god/users/:userId/verify-email',
    async ({ params }) => {
      const updated = await verifyInstanceUserEmail(params.userId);
      if (!updated) throw new HttpError(404, 'User not found');
      return updated;
    },
    {
      params: t.Object({ userId: t.String({ format: 'uuid' }) }),
      response: {
        200: InstanceUserDetailResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: 'Confirm a user email address',
        description:
          'Mark an account as email-confirmed without the user opening a confirmation link.',
      },
    },
  )

  .delete(
    '/god/users/:userId',
    async ({ params, query, user }) => {
      // Hard deletion is the owner's: an admin suspends instead.
      await assertWorkspaceRole(user, 'owner');
      const target = await getInstanceUser(params.userId);
      if (!target) throw new HttpError(404, 'User not found');
      // A workspace owner is not removable here, so the workspace keeps an owner.
      if (target.role === 'owner') throw new HttpError(403, 'A workspace owner cannot be deleted');
      // Teams this user owns alone. Their membership goes with the account, so
      // the team would be left with nobody who can manage it (god mode does not
      // bypass team membership). Either the caller takes those teams down
      // with the account, or the request is refused until another owner is added.
      const sole = target.teams.filter((p) => p.role === 'owner' && p.ownerCount === 1);
      if (sole.length > 0 && !query.withTeams) {
        throw new HttpError(
          400,
          `This user is the only owner of ${sole.map((p) => p.teamKey).join(', ')}. Add another owner first, or delete the teams with the account.`,
        );
      }
      if (query.withTeams) {
        for (const p of sole) await deleteTeam(p.teamId);
      }
      await deleteInstanceUser(params.userId);
      return noContent();
    },
    {
      params: t.Object({ userId: t.String({ format: 'uuid' }) }),
      query: t.Object({
        // Delete the teams this user owns alone along with the account. Every
        // issue, comment and attachment in them goes too.
        withTeams: t.Optional(t.Boolean()),
      }),
      response: {
        204: t.Void(),
        400: ErrorResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: 'Delete a user',
        description:
          'Remove an account from the instance, with its sessions, memberships and preferences. Optionally deletes the teams it owns alone.',
      },
    },
  )

  .get(
    '/god/teams',
    ({ query }) =>
      listInstanceTeams({
        search: query.search,
        limit: query.limit ?? 50,
        offset: query.offset ?? 0,
      }),
    {
      query: t.Object({
        search: t.Optional(t.String()),
        limit: t.Optional(t.Numeric({ minimum: 1, maximum: 200 })),
        offset: t.Optional(t.Numeric({ minimum: 0 })),
      }),
      response: {
        200: t.Object({ items: t.Array(InstanceTeamResponse), total: t.Number() }),
        400: ErrorResponse,
        401: ErrorResponse,
        403: ErrorResponse,
      },
      detail: {
        summary: 'List instance teams',
        description: 'List one page of teams with what each holds, plus how many match the search.',
      },
    },
  )

  .get(
    '/god/teams/:teamId',
    async ({ params }) => {
      const found = await getInstanceTeam(params.teamId);
      if (!found) throw new HttpError(404, 'Team not found');
      return found;
    },
    {
      params: t.Object({ teamId: t.String({ format: 'uuid' }) }),
      response: {
        200: InstanceTeamDetailResponse,
        400: ErrorResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: 'Get an instance team',
        description: 'Get one team with what it holds and every member.',
      },
    },
  );
