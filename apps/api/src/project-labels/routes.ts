import { Elysia, t } from 'elysia';
import { mcpTool } from '../mcp/generate';
import { noContent } from '../shared/http';
import { authContext } from '../shared/auth-context';
import { requireUser, type AuthUser } from '../shared/access';
import { HttpError } from '../shared/lib';
import { ErrorResponse } from '../shared/responses';
import {
  assertLabelManager,
  assertLabelReader,
  createProjectLabel,
  deleteProjectLabel,
  listProjectLabels,
  updateProjectLabel,
} from './store';

const ProjectLabelResponse = t.Object({
  id: t.String({ format: 'uuid' }),
  name: t.String(),
  color: t.String(),
  description: t.Nullable(t.String()),
  parentId: t.Nullable(t.String({ format: 'uuid' })),
  isGroup: t.Boolean(),
  createdAt: t.String(),
  updatedAt: t.String(),
});

const labelParams = t.Object({ labelId: t.String({ format: 'uuid' }) });
const name = t.String({ minLength: 1, maxLength: 80 });
const color = t.String({
  pattern: '^#[0-9a-fA-F]{6}$',
  description: 'Hex color, such as #EB5757.',
});

export const projectLabelRoutes = new Elysia({
  name: 'project-labels',
  detail: { tags: ['Project labels'] },
})
  .use(authContext)
  .macro({
    // Reading: anyone but a guest. Changing: the organization's label-management role.
    labelReader(_enabled: boolean) {
      return {
        async resolve({ user }: { user?: AuthUser | null }) {
          await assertLabelReader(requireUser(user).id);
          return {};
        },
      };
    },
    labelManager(_enabled: boolean) {
      return {
        async resolve({ user }: { user?: AuthUser | null }) {
          await assertLabelManager(requireUser(user).id);
          return {};
        },
      };
    },
  })
  .get('/project-labels', () => listProjectLabels(), {
    labelReader: true,
    response: { 200: t.Array(ProjectLabelResponse), 401: ErrorResponse, 403: ErrorResponse },
    detail: {
      summary: 'List project labels',
      description: 'List the workspace-level project labels and label groups.',
      ...mcpTool('list_project_labels'),
    },
  })
  .post(
    '/project-labels',
    async ({ body, set }) => {
      set.status = 201;
      return createProjectLabel(body);
    },
    {
      labelManager: true,
      body: t.Object({
        name,
        color: t.Optional(color),
        description: t.Optional(t.Nullable(t.String({ maxLength: 255 }))),
        parentId: t.Optional(t.Nullable(t.String({ format: 'uuid' }))),
        isGroup: t.Optional(t.Boolean()),
      }),
      response: {
        201: ProjectLabelResponse,
        400: ErrorResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        409: ErrorResponse,
      },
      detail: {
        summary: 'Create a project label',
        description: 'Create a project label, or a group with isGroup.',
        ...mcpTool('create_project_label'),
      },
    },
  )
  .patch(
    '/project-labels/:labelId',
    async ({ params, body }) => {
      const label = await updateProjectLabel(params.labelId, body);
      if (!label) throw new HttpError(404, 'Project label not found');
      return label;
    },
    {
      labelManager: true,
      params: labelParams,
      body: t.Object({
        name: t.Optional(name),
        color: t.Optional(color),
        description: t.Optional(t.Nullable(t.String({ maxLength: 255 }))),
        parentId: t.Optional(t.Nullable(t.String({ format: 'uuid' }))),
      }),
      response: {
        200: ProjectLabelResponse,
        400: ErrorResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
        409: ErrorResponse,
      },
      detail: {
        summary: 'Update a project label',
        ...mcpTool('update_project_label'),
      },
    },
  )
  .delete(
    '/project-labels/:labelId',
    async ({ params }) => {
      if (!(await deleteProjectLabel(params.labelId)))
        throw new HttpError(404, 'Project label not found');
      return noContent();
    },
    {
      labelManager: true,
      params: labelParams,
      response: { 204: t.Void(), 401: ErrorResponse, 403: ErrorResponse, 404: ErrorResponse },
      detail: {
        summary: 'Delete a project label',
        description: 'Delete a project label; deleting a group deletes its labels.',
        ...mcpTool('delete_project_label'),
      },
    },
  );
