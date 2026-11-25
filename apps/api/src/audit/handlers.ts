import { getActiveSession, type AuditHandlers } from '@repo/auth';
import { HttpError } from '../shared/lib';
import { exportAuditCsv, recordWebExport } from './export';
import { readAuditSettings, setAuditRetention } from './retention';

// The instance plugin's audit log endpoints: the retention period
// (/api/auth/instance/audit-settings*), which Linear's schema has no field for, the
// audit log's CSV export and the record of CSV exports the web builds.

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
  exportCsv: async (headers, body) => {
    const filters =
      body && typeof body === 'object' ? { ...(body as Record<string, unknown>) } : {};
    const { stream } = await exportAuditCsv(await signedIn(headers), filters);
    const day = new Date().toISOString().slice(0, 10);
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="audit-log-${day}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  },
  exportRecorded: async (headers, body) => {
    await recordWebExport(await signedIn(headers), body);
    return { success: true };
  },
};
