import { Elysia, t } from 'elysia';
import { mcpTool } from '../mcp/generate';
import { noContent } from '../shared/http';
import { authContext } from '../shared/auth-context';
import { guards } from '../shared/guards';
import { requireUser, type AuthUser, assertTeamAccess } from '../shared/access';
import { HttpError } from '../shared/lib';
import { ErrorResponse } from '../shared/responses';
import {
  createInvite,
  listInvites,
  deleteInvite,
  getInviteByToken,
  getInviteRowByToken,
  acceptInvite,
  rejectInvite,
} from './store';

const inviteRole = t.Union([t.Literal('owner'), t.Literal('member')]);

// The token is a UUID column. Validating its format here turns a malformed token
// into a 400 instead of letting it reach Postgres and surface as a 500.
const tokenParams = t.Object({ token: t.String({ format: 'uuid' }) });

// An invite's lifecycle status.
const inviteStatus = t.Union([t.Literal('pending'), t.Literal('accepted'), t.Literal('rejected')]);

// The owner-facing invite row (InviteRow from the store).
const InviteRowResponse = t.Object({
  id: t.String({ format: 'uuid' }),
  token: t.String(),
  email: t.String(),
  role: inviteRole,
  status: inviteStatus,
  createdAt: t.String(),
  respondedAt: t.Nullable(t.String()),
  invitedByName: t.Nullable(t.String()),
  invitedByEmail: t.Nullable(t.String()),
});

// The invitee-facing invite view (InviteView from the store).
const InviteViewResponse = t.Object({
  token: t.String(),
  teamKey: t.String(),
  teamName: t.String(),
  email: t.String(),
  role: inviteRole,
  status: inviteStatus,
  createdAt: t.String(),
  hasAccount: t.Boolean(),
});

// The result of accepting an invite: the joined team's context.
const AcceptInviteResponse = t.Object({
  teamKey: t.String(),
  teamName: t.String(),
  role: inviteRole,
});

// Loads the invite named by the token and asserts the caller may act on it: it
// must exist, still be pending, and be addressed to the session email
// (case-insensitive). Shared by accept and reject.
async function loadActionableInvite(token: string, user: AuthUser | undefined | null) {
  const current = requireUser(user);
  const invite = await getInviteRowByToken(token);
  if (!invite) throw new HttpError(404, 'Invite not found');
  if (invite.status !== 'pending') throw new HttpError(409, 'This invite is no longer pending');
  if ((current.email ?? '').toLowerCase() !== invite.email) {
    throw new HttpError(403, 'This invite was sent to a different email');
  }
  return { invite, current };
}

export const inviteRoutes = new Elysia({ name: 'invites', detail: { tags: ['Invites'] } })
  .use(authContext)
  .use(guards)

  // --- Owner-side: manage a team's invites ---

  // Create an invite link for an email + role. An owner invite needs a team manager. A second pending
  // invite for the same email in the same team is a 409.
  .post(
    '/teams/:teamKey/invites',
    async ({ team, body, user, set }) => {
      // Making someone a team owner is team management.
      if (body.role === 'owner') await assertTeamAccess(team.id, user, 'manage');
      const invite = await createInvite({
        teamId: team.id,
        email: body.email,
        role: body.role,
        invitedByUserId: requireUser(user).id,
      });
      set.status = 201;
      return invite;
    },
    {
      params: t.Object({ teamKey: t.String() }),
      body: t.Object({
        email: t.String({ format: 'email' }),
        role: inviteRole,
      }),
      teamAccess: 'see',
      response: {
        201: InviteRowResponse,
        400: ErrorResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
        409: ErrorResponse,
      },
      detail: {
        summary: 'Create an invite',
        description: 'Create an invite link for an email and role (owner or member of the team).',
        ...mcpTool('create_invite'),
      },
    },
  )

  .get(
    '/teams/:teamKey/invites',
    async ({ team }) => {
      return listInvites(team.id);
    },
    {
      params: t.Object({ teamKey: t.String() }),
      teamAccess: 'see',
      response: {
        200: t.Array(InviteRowResponse),
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
      },
      detail: { summary: "List a team's invites", ...mcpTool('list_invites') },
    },
  )

  // Revoke a pending invite (or remove a resolved one). Owner only.
  .delete(
    '/teams/:teamKey/invites/:inviteId',
    async ({ team, params }) => {
      const removed = await deleteInvite(team.id, params.inviteId);
      if (!removed) throw new HttpError(404, 'Invite not found');
      return noContent();
    },
    {
      params: t.Object({ teamKey: t.String(), inviteId: t.String({ format: 'uuid' }) }),
      teamAccess: 'see',
      response: {
        204: t.Void(),
        400: ErrorResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: 'Delete an invite',
        description: 'Revoke a team invite.',
        ...mcpTool('delete_invite'),
      },
    },
  )

  // --- Invitee-side: open, accept, or reject a link ---

  // Look up an invite by its token to render the accept/reject screen. Any
  // authenticated user may read it (the token is unguessable); only the matching
  // email may accept.
  .get(
    '/invites/:token',
    async ({ params }) => {
      const invite = await getInviteByToken(params.token);
      if (!invite) throw new HttpError(404, 'Invite not found');
      return invite;
    },
    {
      params: tokenParams,
      response: {
        200: InviteViewResponse,
        400: ErrorResponse,
        401: ErrorResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: 'Get an invite',
        description: 'Get an invite by its token, with its team and role.',
        ...mcpTool('get_invite'),
      },
    },
  )

  .post(
    '/invites/:token/accept',
    async ({ params, user }) => {
      const { invite, current } = await loadActionableInvite(params.token, user);
      await acceptInvite(invite, current.id);
      const view = await getInviteByToken(params.token);
      return { teamKey: view!.teamKey, teamName: view!.teamName, role: view!.role };
    },
    {
      params: tokenParams,
      response: {
        200: AcceptInviteResponse,
        400: ErrorResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
        409: ErrorResponse,
      },
      detail: {
        summary: 'Accept an invite',
        description: 'Accept an invite (email must match your session).',
        ...mcpTool('accept_invite'),
      },
    },
  )

  .post(
    '/invites/:token/reject',
    async ({ params, user }) => {
      const { invite } = await loadActionableInvite(params.token, user);
      await rejectInvite(invite.id);
      return noContent();
    },
    {
      params: tokenParams,
      response: {
        204: t.Void(),
        400: ErrorResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
        409: ErrorResponse,
      },
      detail: {
        summary: 'Reject an invite',
        description: 'Reject an invite (email must match your session).',
        // Rejecting consumes the invite; it has to be issued again to rejoin.
        ...mcpTool('reject_invite', { destructiveHint: true }),
      },
    },
  );
