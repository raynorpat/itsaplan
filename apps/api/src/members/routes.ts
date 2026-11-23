import { Elysia, t } from 'elysia';
import { mcpTool } from '../mcp/generate';
import { noContent } from '../shared/http';
import { authContext } from '../shared/auth-context';
import { guards } from '../shared/guards';
import { requireUser } from '../shared/access';
import { ErrorResponse } from '../shared/responses';
import { addTeamMember, changeTeamOwner, listMembers, removeTeamMember, joinTeam } from './store';

const memberParams = t.Object({ teamKey: t.String(), userId: t.String({ format: 'uuid' }) });
const memberRole = t.Union([t.Literal('owner'), t.Literal('member')]);

// A member DTO (MemberRow from the store).
const MemberResponse = t.Object({
  userId: t.String({ format: 'uuid' }),
  name: t.String(),
  email: t.String(),
  image: t.Nullable(t.String()),
  role: memberRole,
  createdAt: t.String(),
});

// The membership a join or an add created.
const JoinedResponse = t.Object({ teamKey: t.String(), userId: t.String({ format: 'uuid' }) });

export const memberRoutes = new Elysia({ name: 'members', detail: { tags: ['Members'] } })
  .use(authContext)
  .use(guards)
  // Anyone who can see the team may see who is on it.
  .get(
    '/teams/:teamKey/members',
    async ({ team }) => {
      return listMembers(team.id);
    },
    {
      params: t.Object({ teamKey: t.String() }),
      teamAccess: 'see',
      response: {
        200: t.Array(MemberResponse),
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
      },
      detail: { summary: 'List team members', ...mcpTool('list_members') },
    },
  )

  // Make a member a team owner or a plain member. Team managers only. A team may
  // have no owners; then any of its members manages it.
  // Join a team yourself. Anyone who can see the team may join it, which in
  // practice means public teams for owners, admins and members (a guest or a
  // non-member of a private team cannot see it: 404).
  .post(
    '/teams/:teamKey/join',
    async ({ team, user, set }) => {
      const current = requireUser(user);
      await joinTeam(team.id, current.id);
      set.status = 201;
      return { teamKey: team.key, userId: current.id };
    },
    {
      teamAccess: 'join',
      response: { 201: JoinedResponse, 401: ErrorResponse, 404: ErrorResponse },
      detail: {
        summary: 'Join a team',
        description: 'Join a team you can see (a public team, without an invite).',
        ...mcpTool('join_team'),
      },
    },
  )

  // Add someone to a team. Any team member may add people to a public team; a
  // private team, and making someone a team owner, need a team manager.
  .post(
    '/teams/:teamKey/members',
    async ({ team, body, user, set }) => {
      await addTeamMember(team, body.userId, body.owner ?? false, requireUser(user));
      set.status = 201;
      return { teamKey: team.key, userId: body.userId };
    },
    {
      body: t.Object({ userId: t.String({ format: 'uuid' }), owner: t.Optional(t.Boolean()) }),
      teamAccess: 'join',
      response: {
        201: JoinedResponse,
        400: ErrorResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: 'Add a member',
        description:
          'Add a workspace user to the team, optionally as a team owner. Private teams and ' +
          'team owners need a team manager.',
        ...mcpTool('add_member'),
      },
    },
  )

  .patch(
    '/teams/:teamKey/members/:userId',
    async ({ team, params, body, user }) => {
      // Leaving owner is done by another manager, so nobody demotes themselves by
      // accident.
      await changeTeamOwner(team.id, params.userId, body.role === 'owner', requireUser(user));
      return noContent();
    },
    {
      params: memberParams,
      body: t.Object({ role: memberRole }),
      teamAccess: 'manage',
      response: {
        204: t.Void(),
        400: ErrorResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: "Update a member's role",
        description:
          "Make a member a team owner ('owner') or a plain member ('member'). Team managers only.",
        ...mcpTool('set_member_role'),
      },
    },
  )

  // Remove a member, or leave the team yourself. Removing someone else needs a
  // team manager; a member may always leave.
  .delete(
    '/teams/:teamKey/members/:userId',
    async ({ team, params, user }) => {
      await removeTeamMember(team.id, params.userId, requireUser(user));
      return noContent();
    },
    {
      params: memberParams,
      teamAccess: 'see',
      response: {
        204: t.Void(),
        400: ErrorResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: 'Remove a member',
        description: 'Remove a member from the team, or leave it yourself.',
        ...mcpTool('remove_member'),
      },
    },
  );
