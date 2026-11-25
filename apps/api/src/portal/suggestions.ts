import { createNeed, createRequesterAttachment, MAX_FEEDBACK_BODY } from '../feedback/store';
import { createIssue } from '../issues/store';
import { HttpError } from '../shared/lib';
import { getTeamById } from '../teams/store';
import type { BoardRow } from './boards';
import { allow, LIMITS } from './rate-limit';
import type { Visitor } from './session';

// A visitor's suggestion: a new issue in the board's suggestion team, state and label,
// credited to the visitor's requester (Linear's externalUserCreator, no member
// creator), with their feedback on it quoting the details. It is a normal issue
// creation: webhooks, workflow rules and notifications run as for any new issue.

const MAX_TITLE = 255;

export async function createSuggestion(
  board: BoardRow,
  visitor: Visitor,
  input: { title?: unknown; details?: unknown },
): Promise<{ identifier: string }> {
  if (!board.suggestionsEnabled || !board.suggestionTeamId || !board.suggestionStateId)
    throw new HttpError(403, 'This board does not take suggestions');
  if (typeof input.title !== 'string' || !input.title.trim())
    throw new HttpError(400, 'title is required');
  const title = input.title.trim();
  if (title.length > MAX_TITLE)
    throw new HttpError(400, `title is at most ${MAX_TITLE} characters`);
  if (input.details !== undefined && typeof input.details !== 'string')
    throw new HttpError(400, 'details must be text');
  const details = (input.details ?? '').trim();
  if (details.length > MAX_FEEDBACK_BODY)
    throw new HttpError(400, `details is at most ${MAX_FEEDBACK_BODY} characters`);
  const team = await getTeamById(board.suggestionTeamId);
  if (!team || team.visibility !== 'public')
    throw new HttpError(403, 'This board does not take suggestions');
  const { suggestions } = LIMITS;
  if (!allow(`suggestion:${visitor.requesterId}`, suggestions.limit, suggestions.windowMs))
    throw new HttpError(429, 'Too many suggestions. Try again later.');

  const created = await createIssue(
    team,
    {
      stateId: board.suggestionStateId,
      title,
      description: details,
      labelIds: board.suggestionLabelId ? [board.suggestionLabelId] : [],
      externalUserCreatorId: visitor.requesterId,
      portalSourceBoardId: board.id,
    },
    null,
  );
  const { attachmentId } = await createRequesterAttachment(
    created.id,
    visitor.requesterId,
    'portal',
    null,
  );
  await createNeed({
    issueId: created.id,
    attachmentId,
    body: details || null,
    creatorId: null,
  });
  return { identifier: created.identifier };
}
