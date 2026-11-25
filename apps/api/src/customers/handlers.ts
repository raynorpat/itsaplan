import { getActiveSession, type CustomersHandlers } from '@repo/auth';
import { HttpError } from '../shared/lib';
import { getCustomersSettings, saveCustomersSettings } from './settings';
import { customerPeopleCounts } from './store';

// The instance plugin's Customers endpoints: the switch and the revenue currency
// (/api/auth/instance/customers-settings*), which Linear's OrganizationUpdateInput
// lacks, and the people count of each customer (/customers/people-counts), which
// Linear's Customer type lacks.

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
  peopleCounts: async (headers) => customerPeopleCounts(await signedIn(headers)),
};
