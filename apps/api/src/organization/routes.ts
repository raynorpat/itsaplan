import { Elysia, t } from 'elysia';
import { authContext } from '../shared/auth-context';
import { requireUser } from '../shared/access';
import { ErrorResponse } from '../shared/responses';
import { organizationDto, updateOrganization } from './store';

// The workspace's settings (Linear's Organization) for the web's workspace settings
// page. Everyone signed in reads them; owners and admins change them. Approved email
// domains and the version are read-only (environment and build).

const minimumRole = t.Union([t.Literal('owner'), t.Literal('admin'), t.Literal('member')]);

const OrganizationResponse = t.Object({
  id: t.String({ format: 'uuid' }),
  name: t.String(),
  urlKey: t.String(),
  logoUrl: t.Nullable(t.String()),
  allowedAuthServices: t.Array(t.String()),
  allowedFileUploadContentTypes: t.Array(t.String()),
  teamCreationRole: minimumRole,
  labelManagementRole: minimumRole,
  invitationsRole: minimumRole,
  approvedDomains: t.Array(t.String()),
  version: t.String(),
  createdAt: t.String(),
  updatedAt: t.String(),
});

export const organizationRoutes = new Elysia({
  name: 'organization',
  detail: { tags: ['Organization'] },
})
  .use(authContext)
  .get(
    '/organization',
    async ({ user }) => {
      requireUser(user);
      return (await organizationDto()) as typeof OrganizationResponse.static;
    },
    {
      response: { 200: OrganizationResponse, 401: ErrorResponse },
      detail: {
        summary: 'Get the workspace settings',
        description:
          'Get the workspace name, URL key, logo, allowed sign-in services and upload types, who may create teams, manage labels and invite, the approved email domains and the running version.',
      },
    },
  )
  .patch(
    '/organization',
    async ({ body, user }) => {
      await updateOrganization(body, user);
      return (await organizationDto()) as typeof OrganizationResponse.static;
    },
    {
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1 })),
        urlKey: t.Optional(t.String({ minLength: 1 })),
        logoUrl: t.Optional(t.Nullable(t.String())),
        allowedAuthServices: t.Optional(t.Array(t.String())),
        allowedFileUploadContentTypes: t.Optional(t.Array(t.String())),
        teamCreationRole: t.Optional(minimumRole),
        labelManagementRole: t.Optional(minimumRole),
        invitationsRole: t.Optional(minimumRole),
      }),
      response: {
        200: OrganizationResponse,
        400: ErrorResponse,
        401: ErrorResponse,
        403: ErrorResponse,
      },
      detail: {
        summary: 'Update the workspace settings',
        description: 'Change the workspace settings. Workspace owners and admins only.',
      },
    },
  );
