import { getActiveSession, type AuditHandlers } from '@repo/auth';
import { HttpError } from '../shared/lib';
import { readAuditSettings, setAuditRetention } from './retention';

// The instance plugin's audit log endpoints: the retention period
// (/api/auth/instance/audit-settings*), which Linear's schema has no field for.

async function signedIn(headers: Headers) {
  const session = await getActiveSession(headers);
  if (!session) throw new HttpError(401, 'Authentication required');
  return session.user;
}

export const auditHandlers: AuditHandlers = {
  settings: async (headers) => readAuditSettings(await signedIn(headers)),
  saveSettings: async (headers, body) =>
    setAuditRetention(
      await signedIn(headers),
      body && typeof body === 'object' ? (body as Record<string, unknown>).retention : undefined,
    ),
};
