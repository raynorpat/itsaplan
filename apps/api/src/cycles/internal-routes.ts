import { Elysia } from 'elysia';
import { workerTokenValid } from '../shared/http';
import { runUpkeep } from './store';

// The worker calls this hourly; the cycle upkeep itself runs in the API so its
// changes go through the stores (feed entries, webhooks).
export const internalCycleRoutes = new Elysia({ name: 'internal-cycles' }).post(
  '/internal/cycles/tick',
  async ({ headers, set }) => {
    if (!workerTokenValid(headers)) {
      set.status = 401;
      return { error: 'Unauthorized' };
    }
    await runUpkeep(new Date());
    return { ok: true };
  },
);
