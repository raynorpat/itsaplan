import { db } from '@repo/db';
import { sql } from 'drizzle-orm';
import { Elysia } from 'elysia';
import { workerTokenValid } from '../shared/http';
import { runChangeEmails, runSummaries } from './run';

// The worker calls these on its own schedule (change emails every 2 minutes, summaries
// every 15); the API holds the mail credentials and sends. A run's clock is the
// database's, the same clock that stamps history and comments.
async function dbNow(): Promise<Date> {
  const [row] = await db.execute<{ ms: number }>(
    sql`SELECT (extract(epoch FROM now()) * 1000)::float8 AS ms`,
  );
  return new Date(Number(row!.ms));
}

export const internalRequesterUpdateRoutes = new Elysia({ name: 'internal-requester-updates' })
  .post('/internal/requester-updates/changes', async ({ headers, set }) => {
    if (!workerTokenValid(headers)) {
      set.status = 401;
      return { error: 'Unauthorized' };
    }
    return runChangeEmails(await dbNow());
  })
  .post('/internal/requester-updates/summaries', async ({ headers, set }) => {
    if (!workerTokenValid(headers)) {
      set.status = 401;
      return { error: 'Unauthorized' };
    }
    return runSummaries(await dbNow());
  });
