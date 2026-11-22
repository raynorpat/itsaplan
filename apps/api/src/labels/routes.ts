import { Elysia, t } from 'elysia';
import { requireUser } from '../shared/access';
import { mcpTool } from '../mcp/generate';
import { noContent } from '../shared/http';
import { guards } from '../shared/guards';
import { authContext } from '../shared/auth-context';
import { HttpError, rethrowDuplicate } from '../shared/lib';
import { ErrorResponse } from '../shared/responses';
import {
  createLabel,
  updateLabel,
  deleteLabel,
  createLabelGroup,
  updateLabelGroup,
  deleteLabelGroup,
} from './store';

const labelParams = t.Object({ teamKey: t.String(), labelId: t.String({ format: 'uuid' }) });
const groupParams = t.Object({ teamKey: t.String(), groupId: t.String({ format: 'uuid' }) });

// A label DTO (LabelRow from the store).
const LabelResponse = t.Object({
  id: t.String({ format: 'uuid' }),
  // Null for a workspace label.
  teamId: t.Nullable(t.String({ format: 'uuid' })),
  groupId: t.Nullable(t.String({ format: 'uuid' })),
  name: t.String(),
  color: t.String(),
  retiredAt: t.Nullable(t.String()),
});

// A label group DTO (LabelGroupRow from the store).
const LabelGroupResponse = t.Object({
  id: t.String({ format: 'uuid' }),
  teamId: t.Nullable(t.String({ format: 'uuid' })),
  name: t.String(),
  color: t.String(),
});

export const labelRoutes = new Elysia({ name: 'labels', detail: { tags: ['Labels'] } })
  .use(authContext)
  .use(guards)
  // --- Labels ------------------------------------------------------------------
  .post(
    '/teams/:teamKey/labels',
    async ({ team, body, set, user }) => {
      try {
        set.status = 201;
        return await createLabel({ teamId: team.id, ...body, actorUserId: requireUser(user).id });
      } catch (err) {
        rethrowDuplicate(err, 'label');
      }
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        color: t.Optional(t.String()),
        groupId: t.Optional(t.Nullable(t.String({ format: 'uuid' }))),
      }),
      teamAccess: 'manage',
      response: {
        201: LabelResponse,
        400: ErrorResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
        409: ErrorResponse,
      },
      detail: {
        summary: 'Create a label',
        description: 'Create a label. Optional groupId assigns it to a label group.',
        ...mcpTool('create_label'),
      },
    },
  )

  .patch(
    '/teams/:teamKey/labels/:labelId',
    async ({ params, team, body, user }) => {
      let label;
      try {
        label = await updateLabel(params.labelId, team.id, body, requireUser(user).id);
      } catch (err) {
        rethrowDuplicate(err, 'label');
      }
      if (!label) throw new HttpError(404, 'Label not found');
      return label;
    },
    {
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1 })),
        color: t.Optional(t.String()),
        groupId: t.Optional(t.Nullable(t.String({ format: 'uuid' }))),
      }),
      params: labelParams,
      teamAccess: 'manage',
      response: {
        200: LabelResponse,
        400: ErrorResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
        409: ErrorResponse,
      },
      detail: {
        summary: 'Update a label',
        description:
          "Update a label's name, color, or group. Set groupId to null to remove it from its group.",
        ...mcpTool('update_label'),
      },
    },
  )

  .delete(
    '/teams/:teamKey/labels/:labelId',
    async ({ params, team, user }) => {
      await deleteLabel(params.labelId, team.id, requireUser(user).id);
      return noContent();
    },
    {
      params: labelParams,
      teamAccess: 'manage',
      response: {
        204: t.Void(),
        400: ErrorResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: 'Delete a label',
        description: 'Delete a label.',
        ...mcpTool('delete_label'),
      },
    },
  )

  // --- Label groups ------------------------------------------------------------
  .post(
    '/teams/:teamKey/label-groups',
    async ({ team, body, set, user }) => {
      try {
        set.status = 201;
        return await createLabelGroup({
          teamId: team.id,
          ...body,
          actorUserId: requireUser(user).id,
        });
      } catch (err) {
        rethrowDuplicate(err, 'label group');
      }
    },
    {
      body: t.Object({ name: t.String({ minLength: 1 }), color: t.Optional(t.String()) }),
      teamAccess: 'manage',
      response: {
        201: LabelGroupResponse,
        400: ErrorResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
        409: ErrorResponse,
      },
      detail: {
        summary: 'Create a label group',
        description: 'Create a label group, a named container for labels.',
        ...mcpTool('create_label_group'),
      },
    },
  )

  .patch(
    '/teams/:teamKey/label-groups/:groupId',
    async ({ params, team, body, user }) => {
      let group;
      try {
        group = await updateLabelGroup(params.groupId, team.id, body, requireUser(user).id);
      } catch (err) {
        rethrowDuplicate(err, 'label group');
      }
      if (!group) throw new HttpError(404, 'Label group not found');
      return group;
    },
    {
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1 })),
        color: t.Optional(t.String()),
      }),
      params: groupParams,
      teamAccess: 'manage',
      response: {
        200: LabelGroupResponse,
        400: ErrorResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
        409: ErrorResponse,
      },
      detail: {
        summary: 'Update a label group',
        description: "Update a label group's name or color.",
        ...mcpTool('update_label_group'),
      },
    },
  )

  .delete(
    '/teams/:teamKey/label-groups/:groupId',
    async ({ params, team, user }) => {
      await deleteLabelGroup(params.groupId, team.id, requireUser(user).id);
      return noContent();
    },
    {
      params: groupParams,
      teamAccess: 'manage',
      response: {
        204: t.Void(),
        400: ErrorResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: 'Delete a label group',
        description: 'Delete a label group.',
        ...mcpTool('delete_label_group'),
      },
    },
  );
