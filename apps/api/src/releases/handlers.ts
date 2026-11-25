import { getActiveSession, type AccessKeysHandlers } from '@repo/auth';
import { HttpError } from '../shared/lib';
import { createAccessKey, listAccessKeys, revokeAccessKey } from './keys';

// The instance plugin's release access key endpoints (/api/auth/instance/access-keys*),
// which Linear's schema has no operation for.

async function signedIn(headers: Headers) {
  const session = await getActiveSession(headers);
  if (!session) throw new HttpError(401, 'Authentication required');
  return session.user;
}

const field = (body: unknown, name: string): unknown =>
  body && typeof body === 'object' ? (body as Record<string, unknown>)[name] : undefined;

export const accessKeysHandlers: AccessKeysHandlers = {
  list: async (headers, query) => ({
    accessKeys: await listAccessKeys(await signedIn(headers), query.pipelineId),
  }),
  create: async (headers, body) =>
    createAccessKey(await signedIn(headers), field(body, 'pipelineId')),
  revoke: async (headers, body) => {
    await revokeAccessKey(await signedIn(headers), field(body, 'id'));
    return { success: true };
  },
};
