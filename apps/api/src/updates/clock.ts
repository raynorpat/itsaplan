import { db } from '@repo/db';
import { sql } from 'drizzle-orm';

// The database's clock. History, comments and shares are stamped by it, so every window
// over them (runs, visits) is cut on it too: the API's clock may run ahead or behind.
export async function dbNow(): Promise<Date> {
  const [row] = await db.execute<{ ms: number }>(
    sql`SELECT (extract(epoch FROM now()) * 1000)::float8 AS ms`,
  );
  return new Date(Number(row!.ms));
}
