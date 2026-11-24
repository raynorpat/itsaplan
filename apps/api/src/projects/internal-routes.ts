import { Elysia } from 'elysia';
import { workerTokenValid } from '../shared/http';
import { snapshotProjects } from './progress';
import { purgeTrashedProjects } from './store';

// The worker calls the purge on its cleanup interval and the snapshot with the cycle
// upkeep; both run in the API so their writes go through the stores (the purge's
// deletions send their webhooks).
export const internalProjectRoutes = new Elysia({ name: 'internal-projects' })
  .post('/internal/projects/purge', async ({ headers, set }) => {
    if (!workerTokenValid(headers)) {
      set.status = 401;
      return { error: 'Unauthorized' };
    }
    return { removed: await purgeTrashedProjects(new Date()) };
  })
  .post('/internal/projects/snapshot', async ({ headers, set }) => {
    if (!workerTokenValid(headers)) {
      set.status = 401;
      return { error: 'Unauthorized' };
    }
    return { changed: await snapshotProjects(new Date()) };
  });
