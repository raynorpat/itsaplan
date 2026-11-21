import { Elysia, t } from 'elysia';
import { noContent } from '../shared/http';
import { guards } from '../shared/guards';
import { authContext } from '../shared/auth-context';
import { requireUser } from '../shared/access';
import { HttpError } from '../shared/lib';
import { mcpTool } from '../mcp/generate';
import { ErrorResponse } from '../shared/responses';
import {
  listNoteBoards,
  createNoteBoard,
  getNoteBoard,
  updateNoteBoard,
  deleteNoteBoard,
  type NoteBoardRow,
} from './store';

const boardParams = t.Object({ teamKey: t.String(), boardId: t.String({ format: 'uuid' }) });

// A note board DTO (NoteBoardRow from the store). canvas is a jsonb blob owned by
// the UI (React Flow nodes/edges) and returned verbatim, so it is typed t.Any().
const NoteBoardResponse = t.Object({
  id: t.String({ format: 'uuid' }),
  teamId: t.String({ format: 'uuid' }),
  ownerUserId: t.Nullable(t.String({ format: 'uuid' })),
  name: t.String(),
  canvas: t.Any(),
  createdAt: t.String(),
  updatedAt: t.String(),
});

// The list/switcher DTO: the board without its canvas.
const NoteBoardSummaryResponse = t.Omit(NoteBoardResponse, ['canvas']);

// Load a board that belongs to this team and that the user may access: a
// public board (no owner) is open to any member; a personal board only to its
// owner. Anything else is a 404 so a personal board's existence does not leak.
async function loadAccessibleBoard(
  boardId: string,
  teamId: string,
  userId: string,
): Promise<NoteBoardRow> {
  const board = await getNoteBoard(boardId);
  if (!board || board.teamId !== teamId) throw new HttpError(404, 'Board not found');
  if (board.ownerUserId !== null && board.ownerUserId !== userId) {
    throw new HttpError(404, 'Board not found');
  }
  return board;
}

export const noteBoardRoutes = new Elysia({
  name: 'note-boards',
  detail: { tags: ['Note boards'] },
})
  .use(authContext)
  .use(guards)
  .get(
    '/teams/:teamKey/note-boards',
    async ({ team, user, query }) => {
      return listNoteBoards(team.id, requireUser(user).id, {
        q: query.q,
        limit: query.limit ?? 10,
        offset: query.offset ?? 0,
      });
    },
    {
      teamMember: true,
      // Paged for the board switcher: `q` filters by name, `limit`/`offset` page
      // the result. Canvas is omitted; open a board to load its canvas.
      query: t.Object({
        q: t.Optional(t.String()),
        limit: t.Optional(t.Numeric({ minimum: 1, maximum: 50 })),
        offset: t.Optional(t.Numeric({ minimum: 0 })),
      }),
      response: {
        200: t.Array(NoteBoardSummaryResponse),
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
      },
      detail: { summary: "List a team's note boards", ...mcpTool('list_note_boards') },
    },
  )

  .get(
    '/teams/:teamKey/note-boards/:boardId',
    async ({ team, user, params }) => {
      return loadAccessibleBoard(params.boardId, team.id, requireUser(user).id);
    },
    {
      teamMember: true,
      params: boardParams,
      response: {
        200: NoteBoardResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
      },
      detail: { summary: 'Get a note board with its canvas', ...mcpTool('get_note_board') },
    },
  )

  .post(
    '/teams/:teamKey/note-boards',
    async ({ team, user, body, set }) => {
      const userId = requireUser(user).id;
      set.status = 201;
      return createNoteBoard({
        teamId: team.id,
        ownerUserId: body.personal ? userId : null,
        name: body.name,
        canvas: body.canvas,
      });
    },
    {
      teamMember: true,
      body: t.Object({
        name: t.String({ minLength: 1 }),
        // true creates a personal board owned by the caller; false/omitted a
        // public board visible to every member.
        personal: t.Optional(t.Boolean()),
        canvas: t.Optional(t.Any()),
      }),
      response: {
        201: NoteBoardResponse,
        400: ErrorResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
      },
      detail: { summary: 'Create a note board', ...mcpTool('create_note_board') },
    },
  )

  .patch(
    '/teams/:teamKey/note-boards/:boardId',
    async ({ team, user, params, body }) => {
      const userId = requireUser(user).id;
      await loadAccessibleBoard(params.boardId, team.id, userId);
      const patch: { name?: string; canvas?: unknown; ownerUserId?: string | null } = {};
      if (body.name !== undefined) patch.name = body.name;
      if (body.canvas !== undefined) patch.canvas = body.canvas;
      // personal true makes the board owned by (private to) the caller; false makes
      // it public. Only a user who can already access the board reaches here.
      if (body.personal !== undefined) patch.ownerUserId = body.personal ? userId : null;
      const board = await updateNoteBoard(params.boardId, patch);
      if (!board) throw new HttpError(404, 'Board not found');
      return board;
    },
    {
      teamMember: true,
      params: boardParams,
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1 })),
        canvas: t.Optional(t.Any()),
        personal: t.Optional(t.Boolean()),
      }),
      response: {
        200: NoteBoardResponse,
        400: ErrorResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
      },
      detail: { summary: 'Update a note board', ...mcpTool('update_note_board') },
    },
  )

  .delete(
    '/teams/:teamKey/note-boards/:boardId',
    async ({ team, user, params }) => {
      await loadAccessibleBoard(params.boardId, team.id, requireUser(user).id);
      await deleteNoteBoard(params.boardId);
      return noContent();
    },
    {
      teamMember: true,
      params: boardParams,
      response: {
        204: t.Void(),
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
      },
      detail: { summary: 'Delete a note board', ...mcpTool('delete_note_board') },
    },
  );
