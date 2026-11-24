import { Elysia } from 'elysia';
import { workerTokenValid } from '../shared/http';
import { purgeTrashedProjects } from './store';

// The worker calls this on its cleanup interval; the purge runs in the API so the
// deletions send their webhooks through the store.
export const internalProjectRoutes = new Elysia({ name: 'internal-projects' }).post(
  '/internal/projects/purge',
  async ({ headers, set }) => {
    if (!workerTokenValid(headers)) {
      set.status = 401;
      return { error: 'Unauthorized' };
    }
    return { removed: await purgeTrashedProjects(new Date()) };
  },
);
