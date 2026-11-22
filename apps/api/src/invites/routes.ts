import { Elysia, t } from 'elysia';
import { mcpTool } from '../mcp/generate';
import { noContent } from '../shared/http';
import { authContext } from '../shared/auth-context';
import { assertWorkspaceRole, atLeast, requireUser, workspaceRole } from '../shared/access';
import { HttpError } from '../shared/lib';
import { ErrorResponse } from '../shared/responses';
import { getInviteByToken, inviteToWorkspace, listInvites, revokeInvite } from './store';

// Workspace invites (Linear's organization invites): an address is invited with a
// role and teams, both applied when it signs up. Owners, admins and members invite;
// nobody invites above their own role (an admin may invite admins, a member only
// members and guests). Guests do not invite.

const inviteRole = t.Union([t.Literal('admin'), t.Literal('member'), t.Literal('guest')]);
// Both routes on /invites/:id share the param name; the lookup route reads it as
// the invite's token, the delete route as the invite's id.
const idParams = t.Object({ id: t.String({ format: 'uuid' }) });

const InviteRowResponse = t.Object({
  id: t.String({ format: 'uuid' }),
  // The invite link's token: shown to the invite's sender and to admins and owners
  // (copy link), null for everyone else, so an invite cannot be claimed by another
  // member.
  token: t.Nullable(t.String()),
  email: t.String(),
  role: inviteRole,
  teamIds: t.Array(t.String()),
  createdAt: t.String(),
  expiresAt: t.String(),
  invitedByUserId: t.Nullable(t.String()),
  invitedByName: t.Nullable(t.String()),
});

const InviteViewResponse = t.Object({
  token: t.String(),
  email: t.String(),
  role: inviteRole,
  teamNames: t.Array(t.String()),
  invitedByName: t.Nullable(t.String()),
  expiresAt: t.String(),
});

export const inviteRoutes = new Elysia({ name: 'invites', detail: { tags: ['Invites'] } })
  .use(authContext)

  .post(
    '/invites',
    async ({ body, user, set }) => {
      const created = await inviteToWorkspace(body, requireUser(user));
      set.status = 201;
      return created;
    },
    {
      body: t.Object({
        email: t.String({ format: 'email' }),
        role: inviteRole,
        teamIds: t.Optional(t.Array(t.String({ format: 'uuid' }))),
      }),
      response: {
        201: InviteRowResponse,
        400: ErrorResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
        409: ErrorResponse,
      },
      detail: {
        summary: 'Invite to the workspace',
        description:
          'Invite an email address to the workspace with a role (admin, member or guest) and ' +
          'optional teams, applied when the address signs up. Not above your own role.',
        ...mcpTool('create_invite'),
      },
    },
  )

  .get(
    '/invites',
    async ({ user }) => {
      await assertWorkspaceRole(user, 'member');
      const viewer = requireUser(user);
      const admin = atLeast(await workspaceRole(viewer.id), 'admin');
      return (await listInvites()).map((i) =>
        admin || i.invitedByUserId === viewer.id ? i : { ...i, token: null },
      );
    },
    {
      response: { 200: t.Array(InviteRowResponse), 401: ErrorResponse, 403: ErrorResponse },
      detail: { summary: 'List pending workspace invites', ...mcpTool('list_invites') },
    },
  )

  .delete(
    '/invites/:id',
    async ({ params, user }) => {
      await revokeInvite(params.id, requireUser(user));
      return noContent();
    },
    {
      params: idParams,
      response: {
        204: t.Void(),
        400: ErrorResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: 'Revoke a workspace invite',
        description: 'Revoke a pending invite: its sender, or a workspace admin.',
        ...mcpTool('delete_invite', { destructiveHint: true }),
      },
    },
  )

  // The invite behind a link, for the sign-up screen. Public: the address has no
  // account yet, and the token is unguessable.
  .get(
    '/invites/:id',
    async ({ params }) => {
      const invite = await getInviteByToken(params.id);
      if (!invite) throw new HttpError(404, 'Invite not found');
      return invite;
    },
    {
      params: idParams,
      response: { 200: InviteViewResponse, 400: ErrorResponse, 404: ErrorResponse },
      detail: { summary: 'Get an invite by its token' },
    },
  );
