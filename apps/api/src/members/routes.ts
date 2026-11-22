import { Elysia, t } from 'elysia';
import { mcpTool } from '../mcp/generate';
import { noContent } from '../shared/http';
import { authContext } from '../shared/auth-context';
import { guards } from '../shared/guards';
import { assertTeamAccess, canManageTeam, requireUser } from '../shared/access';
import { HttpError } from '../shared/lib';
import { ErrorResponse } from '../shared/responses';
import {
  listMembers,
  getMembership,
  removeMember,
  setMembership,
  setMemberDescription,
} from './store';

const memberParams = t.Object({ teamKey: t.String(), userId: t.String({ format: 'uuid' }) });
const memberRole = t.Union([t.Literal('owner'), t.Literal('member')]);

// A member DTO (MemberRow from the store).
const MemberResponse = t.Object({
  userId: t.String({ format: 'uuid' }),
  name: t.String(),
  email: t.String(),
  image: t.Nullable(t.String()),
  role: memberRole,
  description: t.String(),
  createdAt: t.String(),
});

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
  .patch(
    '/teams/:teamKey/members/:userId',
    async ({ team, params, body, user }) => {
      // Leaving owner is done by another manager, so nobody demotes themselves by
      // accident.
      if (params.userId === requireUser(user).id) {
        throw new HttpError(400, 'You cannot change your own role');
      }
      const ok = await setMembership(team.id, params.userId, body.role);
      if (!ok) throw new HttpError(404, 'Member not found');
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

  // Set a member's team description (what they do). A member may edit their own;
  // a team manager may edit anyone's. The description is shown on the members page and
  // given to agents so they can pick who to tag on an unassigned issue.
  .patch(
    '/teams/:teamKey/members/:userId/description',
    async ({ team, params, body, user }) => {
      const current = requireUser(user);
      if (params.userId !== current.id && !(await canManageTeam(team.id, current.id))) {
        throw new HttpError(403, "Only a team manager can edit another member's description");
      }
      const ok = await setMemberDescription(team.id, params.userId, body.description);
      if (!ok) throw new HttpError(404, 'Member not found');
      return noContent();
    },
    {
      params: memberParams,
      body: t.Object({ description: t.String({ maxLength: 500 }) }),
      teamAccess: 'see',
      response: {
        204: t.Void(),
        400: ErrorResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: "Set a member's description",
        description:
          'Set what a member does in the team. Up to 500 characters; empty string clears it.',
        ...mcpTool('set_member_description'),
      },
    },
  )

  // Remove a member, or leave the team yourself. Removing someone else needs a
  // team manager; a member may always leave. New members join through
  // invites, so there is no direct add here.
  .delete(
    '/teams/:teamKey/members/:userId',
    async ({ team, params, user }) => {
      const current = requireUser(user);
      const isSelf = params.userId === current.id;
      if (!isSelf) {
        await assertTeamAccess(team.id, user, 'manage');
      }
      const target = await getMembership(team.id, params.userId);
      if (!target) throw new HttpError(404, 'Member not found');
      await removeMember(team.id, params.userId);
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
