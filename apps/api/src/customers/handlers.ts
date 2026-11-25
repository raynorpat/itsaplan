import { getActiveSession, type CustomersHandlers } from '@repo/auth';
import { HttpError } from '../shared/lib';
import { getCustomersSettings, saveCustomersSettings } from './settings';

// The instance plugin's Customers endpoints (/api/auth/instance/customers-settings*):
// the switch and the revenue currency, which Linear's OrganizationUpdateInput lacks.

async function signedIn(headers: Headers) {
  const session = await getActiveSession(headers);
  if (!session) throw new HttpError(401, 'Authentication required');
  return session.user;
}

const fields = (body: unknown): Record<string, unknown> =>
  body && typeof body === 'object' ? (body as Record<string, unknown>) : {};

export const customersHandlers: CustomersHandlers = {
  settings: async (headers) => getCustomersSettings((await signedIn(headers)).id),
  saveSettings: async (headers, body) =>
    saveCustomersSettings(await signedIn(headers), fields(body)),
};
