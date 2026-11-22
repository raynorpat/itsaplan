import { Elysia, t } from 'elysia';
import { mcpTool } from '../mcp/generate';
import { noContent } from '../shared/http';
import { authContext } from '../shared/auth-context';
import { assertWorkspaceRole, requireUser } from '../shared/access';
import { ErrorResponse } from '../shared/responses';
import { changeWorkspaceRole, listWorkspaceUsers, suspendUser, unsuspendUser } from './store';

const roleSchema = t.Union([
  t.Literal('owner'),
  t.Literal('admin'),
  t.Literal('member'),
  t.Literal('guest'),
]);
const userParams = t.Object({ userId: t.String({ format: 'uuid' }) });

const WorkspaceUserResponse = t.Object({
  userId: t.String({ format: 'uuid' }),
  name: t.String(),
  email: t.String(),
  image: t.Nullable(t.String()),
  role: roleSchema,
  suspendedAt: t.Nullable(t.String()),
  createdAt: t.String(),
});

const errors = {
  400: ErrorResponse,
  401: ErrorResponse,
  403: ErrorResponse,
  404: ErrorResponse,
};

export const workspaceRoutes = new Elysia({ name: 'workspace', detail: { tags: ['Workspace'] } })
  .use(authContext)

  .get(
    '/workspace/users',
    async ({ user }) => {
      await assertWorkspaceRole(user, 'member');
      return listWorkspaceUsers();
    },
    {
      response: { 200: t.Array(WorkspaceUserResponse), 401: ErrorResponse, 403: ErrorResponse },
      detail: { summary: 'List workspace users', ...mcpTool('list_workspace_users') },
    },
  )

  .patch(
    '/workspace/users/:userId',
    ({ params, body, user }) => changeWorkspaceRole(params.userId, body.role, requireUser(user).id),
    {
      params: userParams,
      body: t.Object({ role: roleSchema }),
      response: { 200: WorkspaceUserResponse, ...errors },
      detail: {
        summary: "Change a user's workspace role",
        description:
          'Owner, admin, member or guest. Admins change members and guests; only owners ' +
          'make or remove owners; the workspace keeps at least one owner.',
        ...mcpTool('set_workspace_role'),
      },
    },
  )

  .post(
    '/workspace/users/:userId/suspend',
    async ({ params, user }) => {
      await suspendUser(params.userId, requireUser(user).id);
      return noContent();
    },
    {
      params: userParams,
      response: { 204: t.Void(), ...errors },
      detail: {
        summary: 'Suspend a user',
        description: 'The user can no longer sign in or use API keys. Their history stays.',
        ...mcpTool('suspend_user', { destructiveHint: true }),
      },
    },
  )

  .post(
    '/workspace/users/:userId/unsuspend',
    async ({ params, user }) => {
      await unsuspendUser(params.userId, requireUser(user).id);
      return noContent();
    },
    {
      params: userParams,
      response: { 204: t.Void(), ...errors },
      detail: { summary: 'Unsuspend a user', ...mcpTool('unsuspend_user') },
    },
  );
