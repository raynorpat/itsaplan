import { Elysia, t } from 'elysia';
import { mcpTool } from '../mcp/generate';
import { noContent } from '../shared/http';
import { guards } from '../shared/guards';
import { HttpError } from '../shared/lib';
import { ErrorResponse } from '../shared/responses';
import { createIssueType, updateIssueType, deleteIssueType } from './store';

const typeParams = t.Object({ teamKey: t.String(), typeId: t.String({ format: 'uuid' }) });

// An issue type DTO (IssueTypeRow from the store).
const IssueTypeResponse = t.Object({
  id: t.String({ format: 'uuid' }),
  teamId: t.String({ format: 'uuid' }),
  name: t.String(),
  icon: t.String(),
  color: t.String(),
  isDefault: t.Boolean(),
  position: t.Number(),
});

export const issueTypeRoutes = new Elysia({
  name: 'issue-types',
  detail: { tags: ['Issue Types'] },
})
  .use(guards)
  .post(
    '/teams/:teamKey/issue-types',
    async ({ team, body, set }) => {
      set.status = 201;
      return createIssueType({ teamId: team.id, ...body });
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        icon: t.Optional(t.String()),
        color: t.Optional(t.String()),
        isDefault: t.Optional(t.Boolean()),
      }),
      permission: ['issue_types', 'create'],
      response: {
        201: IssueTypeResponse,
        400: ErrorResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: 'Create an issue type',
        description:
          'Create an issue type. Set isDefault to make it the default type for new issues.',
        ...mcpTool('create_issue_type'),
      },
    },
  )

  .patch(
    '/teams/:teamKey/issue-types/:typeId',
    async ({ params, team, body }) => {
      const type = await updateIssueType(params.typeId, team.id, body);
      if (!type) throw new HttpError(404, 'Issue type not found');
      return type;
    },
    {
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1 })),
        color: t.Optional(t.String()),
        isDefault: t.Optional(t.Boolean()),
      }),
      params: typeParams,
      permission: ['issue_types', 'edit'],
      response: {
        200: IssueTypeResponse,
        400: ErrorResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: 'Update an issue type',
        description: "Update an issue type's name, color, or default flag.",
        ...mcpTool('update_issue_type'),
      },
    },
  )

  .delete(
    '/teams/:teamKey/issue-types/:typeId',
    async ({ params, team }) => {
      await deleteIssueType(params.typeId, team.id);
      return noContent();
    },
    {
      params: typeParams,
      permission: ['issue_types', 'delete'],
      response: {
        204: t.Void(),
        400: ErrorResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: 'Delete an issue type',
        description: 'Delete an issue type.',
        ...mcpTool('delete_issue_type'),
      },
    },
  );
