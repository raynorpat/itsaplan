import { Elysia } from 'elysia';
import { workerTokenValid } from '../shared/http';
import { runChangeEmails, runSummaries } from './run';

// The worker calls these on its own schedule (change emails every 2 minutes, summaries
// every 15); the API holds the mail credentials and sends.
export const internalRequesterUpdateRoutes = new Elysia({ name: 'internal-requester-updates' })
  .post('/internal/requester-updates/changes', async ({ headers, set }) => {
    if (!workerTokenValid(headers)) {
      set.status = 401;
      return { error: 'Unauthorized' };
    }
    return runChangeEmails(new Date());
  })
  .post('/internal/requester-updates/summaries', async ({ headers, set }) => {
    if (!workerTokenValid(headers)) {
      set.status = 401;
      return { error: 'Unauthorized' };
    }
    return runSummaries(new Date());
  });
