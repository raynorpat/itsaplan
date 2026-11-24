import { db } from '@repo/db';

// Counts the SQL statements `run` sends through the db client (optionally only those
// whose text includes `match`), for tests that bound a request's query count.

type Client = { unsafe: (...args: unknown[]) => unknown };

export async function countStatements(
  run: () => Promise<unknown>,
  match?: string,
): Promise<number> {
  const client = db.$client as unknown as Client;
  const original = client.unsafe;
  let count = 0;
  client.unsafe = function (this: unknown, ...args: unknown[]) {
    if (
      !match ||
      String(args[0] ?? '')
        .toLowerCase()
        .includes(match)
    )
      count += 1;
    return original.apply(this, args);
  } as Client['unsafe'];
  try {
    await run();
  } finally {
    client.unsafe = original;
  }
  return count;
}
