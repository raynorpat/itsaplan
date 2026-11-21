import { Elysia, t } from 'elysia';
import { noContent } from '../shared/http';
import { guards } from '../shared/guards';
import { HttpError } from '../shared/lib';
import { ErrorResponse } from '../shared/responses';
import { mcpTool } from '../mcp/generate';
import { listCustomFields, createCustomField, updateCustomField, deleteCustomField } from './store';
import { getIssueTypeById } from '../issue-types/store';

const fieldType = t.Union([
  t.Literal('text'),
  t.Literal('markdown'),
  t.Literal('url'),
  t.Literal('number'),
  t.Literal('boolean'),
  t.Literal('date'),
  t.Literal('select'),
  t.Literal('multi_select'),
]);

const fieldParams = t.Object({ teamKey: t.String(), fieldId: t.String({ format: 'uuid' }) });

// A field option DTO (CustomFieldOptionRow from the store).
const CustomFieldOptionResponse = t.Object({
  id: t.String({ format: 'uuid' }),
  value: t.String(),
  color: t.String(),
  position: t.Number(),
});

// A custom field DTO (CustomFieldRow from the store).
const CustomFieldResponse = t.Object({
  id: t.String({ format: 'uuid' }),
  issueTypeId: t.Nullable(t.String({ format: 'uuid' })),
  name: t.String(),
  fieldType,
  showInBody: t.Boolean(),
  position: t.Number(),
  options: t.Array(CustomFieldOptionResponse),
});

export const customFieldRoutes = new Elysia({
  name: 'custom-fields',
  detail: { tags: ['Custom Fields'] },
})
  .use(guards)
  // issueTypeId query param includes that type's own fields alongside the
  // team-wide ones; omitting it returns only the team-wide fields.
  .get(
    '/teams/:teamKey/custom-fields',
    async ({ team, query }) => {
      return listCustomFields(team.id, { issueTypeId: query.issueTypeId });
    },
    {
      params: t.Object({ teamKey: t.String() }),
      query: t.Object({ issueTypeId: t.Optional(t.String({ format: 'uuid' })) }),
      permission: ['custom_fields', 'read'],
      response: {
        200: t.Array(CustomFieldResponse),
        400: ErrorResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: "List a team's custom fields",
        description: "List a team's custom fields.",
        ...mcpTool('list_custom_fields'),
      },
    },
  )

  .post(
    '/teams/:teamKey/custom-fields',
    async ({ team, body, set }) => {
      // A type-scoped field must target an issue type of this team.
      if (body.issueTypeId != null) {
        const type = await getIssueTypeById(body.issueTypeId);
        if (!type || type.teamId !== team.id) {
          throw new HttpError(400, 'issueTypeId does not belong to this team');
        }
      }
      set.status = 201;
      return createCustomField({ teamId: team.id, ...body });
    },
    {
      params: t.Object({ teamKey: t.String() }),
      body: t.Object({
        issueTypeId: t.Optional(t.Nullable(t.String({ format: 'uuid' }))),
        name: t.String({ minLength: 1 }),
        fieldType,
        showInBody: t.Optional(t.Boolean()),
        options: t.Optional(t.Array(t.String({ minLength: 1 }))),
      }),
      permission: ['custom_fields', 'create'],
      response: {
        201: CustomFieldResponse,
        400: ErrorResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: 'Create a custom field',
        description: 'Create a custom field for a team.',
        ...mcpTool('create_custom_field'),
      },
    },
  )

  .patch(
    '/teams/:teamKey/custom-fields/:fieldId',
    async ({ team, params, body }) => {
      const field = await updateCustomField(team.id, params.fieldId, body);
      if (!field) throw new HttpError(404, 'Custom field not found');
      return field;
    },
    {
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1 })),
        showInBody: t.Optional(t.Boolean()),
      }),
      params: fieldParams,
      permission: ['custom_fields', 'edit'],
      response: {
        200: CustomFieldResponse,
        400: ErrorResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: 'Update a custom field',
        description: 'Update a custom field.',
        ...mcpTool('update_custom_field'),
      },
    },
  )

  .delete(
    '/teams/:teamKey/custom-fields/:fieldId',
    async ({ team, params }) => {
      const deleted = await deleteCustomField(team.id, params.fieldId);
      if (!deleted) throw new HttpError(404, 'Custom field not found');
      return noContent();
    },
    {
      params: fieldParams,
      permission: ['custom_fields', 'delete'],
      response: {
        204: t.Void(),
        400: ErrorResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: 'Delete a custom field',
        description: 'Delete a custom field.',
        ...mcpTool('delete_custom_field'),
      },
    },
  );
