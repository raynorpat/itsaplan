import { Elysia, t } from 'elysia';
import { noContent } from '../shared/http';
import { authContext } from '../shared/auth-context';
import { guards } from '../shared/guards';
import { requireUser } from '../shared/access';
import { HttpError, rejectUnknownFields } from '../shared/lib';
import { ErrorResponse } from '../shared/responses';
import {
  archiveState,
  createState,
  deleteState,
  listStates,
  reorderStates,
  updateState,
} from './store';

const stateType = t.Union([
  t.Literal('backlog'),
  t.Literal('unstarted'),
  t.Literal('started'),
  t.Literal('completed'),
  t.Literal('canceled'),
]);

const stateParams = t.Object({ teamKey: t.String(), stateId: t.String({ format: 'uuid' }) });

// A column DTO (WorkflowStateRow from the store).
const WorkflowStateResponse = t.Object({
  id: t.String({ format: 'uuid' }),
  teamId: t.String({ format: 'uuid' }),
  name: t.String(),
  stateType: t.String(),
  color: t.String(),
  description: t.String(),
  position: t.Number(),
  archivedAt: t.Nullable(t.String()),
});

export const stateRoutes = new Elysia({ name: 'states', detail: { tags: ['States'] } })
  .use(authContext)
  .use(guards)
  .post(
    '/teams/:teamKey/states',
    async ({ team, body, set }) => {
      set.status = 201;
      return createState({ teamId: team.id, ...body });
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        stateType,
        color: t.Optional(t.String()),
        description: t.Optional(t.String()),
      }),
      teamAccess: 'manage',
      response: {
        201: WorkflowStateResponse,
        400: ErrorResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: 'Create a column',
        description:
          'Create a column (workflow state). stateType is one of ' +
          'backlog/unstarted/started/completed/canceled.',
      },
    },
  )

  // Reorders the team's columns. Body carries the full desired left-to-right
  // order of column ids; the store renumbers positions to match.
  .put(
    '/teams/:teamKey/states/reorder',
    async ({ team, body }) => {
      await reorderStates(team.id, body.orderedIds);
      return listStates(team.id);
    },
    {
      body: t.Object({ orderedIds: t.Array(t.String({ format: 'uuid' }), { minItems: 1 }) }),
      teamAccess: 'manage',
      response: {
        200: t.Array(WorkflowStateResponse),
        400: ErrorResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: 'Reorder columns',
        description:
          "Reorder a team's columns. orderedIds is the full left-to-right list of " +
          'column ids. Returns the reordered columns.',
      },
    },
  )

  .patch(
    '/teams/:teamKey/states/:stateId',
    async ({ params, team, body }) => {
      const column = await updateState(params.stateId, team.id, body);
      if (!column) throw new HttpError(404, 'Column not found');
      return column;
    },
    {
      // A state's type is fixed once created (Linear); unknown fields are refused.
      transform: ({ body }) => rejectUnknownFields(body, ['name', 'color', 'description']),
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1 })),
        color: t.Optional(t.String()),
        description: t.Optional(t.String()),
      }),
      params: stateParams,
      teamAccess: 'manage',
      response: {
        200: WorkflowStateResponse,
        400: ErrorResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: 'Update a column',
        description: "Update a column's name, color, or description. The type is fixed.",
      },
    },
  )

  .post(
    '/teams/:teamKey/states/:stateId/archive',
    async ({ params, team }) => archiveState(params.stateId, team.id),
    {
      params: stateParams,
      teamAccess: 'manage',
      response: {
        200: WorkflowStateResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
        409: ErrorResponse,
      },
      detail: {
        summary: 'Archive a column',
        description:
          'Archive a column (workflow state). It must hold no active issues and must ' +
          'not be the last active column of its state type.',
      },
    },
  )

  // Deletes a column. Body picks what happens to its issues: mode 'move' reassigns
  // them to targetStateId, mode 'delete' removes them. Backlog columns are
  // rejected by the store layer.
  .delete(
    '/teams/:teamKey/states/:stateId',
    async ({ params, team, body, user }) => {
      await deleteState(params.stateId, team.id, body, requireUser(user).id);
      return noContent();
    },
    {
      body: t.Union([
        t.Object({ mode: t.Literal('move'), targetStateId: t.String({ format: 'uuid' }) }),
        t.Object({ mode: t.Literal('delete') }),
      ]),
      params: stateParams,
      teamAccess: 'manage',
      response: {
        204: t.Void(),
        400: ErrorResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: 'Delete a column',
        description:
          "Delete a column. Body mode 'move' reassigns its issues to targetStateId, " +
          "'delete' removes them. Backlog columns cannot be deleted.",
      },
    },
  );
