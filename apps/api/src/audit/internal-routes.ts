import { Elysia } from 'elysia';
import { workerTokenValid } from '../shared/http';
import { withAuditRequest } from './context';
import { cleanupAuditEntries } from './retention';

// The worker calls the clean-up on its cleanup interval; it deletes entries older than
// the retention period.
export const internalAuditRoutes = new Elysia({ name: 'internal-audit' }).post(
  '/internal/audit/cleanup',
  async ({ headers, set }) => {
    if (!workerTokenValid(headers)) {
      set.status = 401;
      return { error: 'Unauthorized' };
    }
    const removed = await withAuditRequest(
      { ip: null, countryCode: null, userAgent: null, method: 'worker' },
      () => cleanupAuditEntries(new Date()),
    );
    return { removed };
  },
);
