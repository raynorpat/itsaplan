import { getActiveSession, type AccountEmailsHandlers } from '@repo/auth';
import { HttpError } from '../shared/lib';
import { addEmail, confirmEmail, listEmails, removeEmail } from './emails';

// The instance plugin's account email endpoints (packages/auth src/instance-plugin.ts):
// a signed-in user's extra addresses. Confirm needs no session; the link's token is
// its credential.

async function userId(headers: Headers): Promise<string> {
  const session = await getActiveSession(headers);
  if (!session) throw new HttpError(401, 'Authentication required');
  return session.user.id;
}

const field = (body: unknown, key: string): unknown =>
  body && typeof body === 'object' ? (body as Record<string, unknown>)[key] : undefined;

export const accountEmailsHandlers: AccountEmailsHandlers = {
  list: async (headers) => ({ emails: await listEmails(await userId(headers)) }),
  add: async (headers, body) => ({
    email: await addEmail(await userId(headers), field(body, 'email')),
  }),
  remove: async (headers, body) => {
    await removeEmail(await userId(headers), field(body, 'id'));
    return { success: true };
  },
  confirm: (token) => confirmEmail(token),
};
