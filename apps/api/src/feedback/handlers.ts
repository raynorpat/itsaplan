import { getActiveSession, type RequestersHandlers } from '@repo/auth';
import { HttpError } from '../shared/lib';
import { shareProjectUpdate, sharedProjectUpdateIds } from '../updates/share';
import {
  createRequester,
  createTeamFeedbackAttachment,
  feedbackPeopleCount,
  getRequester,
  listRequesters,
  mergeRequesters,
  setRequesterUpdates,
  updateRequester,
} from './requesters';

// The instance plugin's requester endpoints (packages/auth src/instance-plugin.ts):
// a signed-in user (session cookie or API key) finding and managing the people who
// give feedback, and creating the attachment that names who gave a feedback item.

async function signedIn(headers: Headers) {
  const session = await getActiveSession(headers);
  if (!session) throw new HttpError(401, 'Authentication required');
  return session.user;
}

const fields = (body: unknown): Record<string, unknown> =>
  body && typeof body === 'object' ? (body as Record<string, unknown>) : {};

export const requestersHandlers: RequestersHandlers = {
  list: async (headers, query) => listRequesters((await signedIn(headers)).id, query),
  get: async (headers, query) => ({
    requester: await getRequester((await signedIn(headers)).id, query.id),
  }),
  create: async (headers, body) => ({
    requester: await createRequester((await signedIn(headers)).id, fields(body)),
  }),
  update: async (headers, body) => ({
    requester: await updateRequester((await signedIn(headers)).id, fields(body)),
  }),
  merge: async (headers, body) => ({
    requester: await mergeRequesters(await signedIn(headers), fields(body)),
  }),
  updates: async (headers, body) => ({
    requester: await setRequesterUpdates((await signedIn(headers)).id, fields(body)),
  }),
  shareProjectUpdate: async (headers, body) =>
    shareProjectUpdate((await signedIn(headers)).id, fields(body)),
  sharedProjectUpdates: async (headers, query) =>
    sharedProjectUpdateIds((await signedIn(headers)).id, query),
  feedbackAttachment: async (headers, body) =>
    createTeamFeedbackAttachment(await signedIn(headers), fields(body)),
  feedbackCount: async (headers, query) => feedbackPeopleCount((await signedIn(headers)).id, query),
};
