import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { db, user } from '@repo/db';
import { getTableColumns, inArray, sql } from 'drizzle-orm';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { newestFirst, paginateSorted, type SortKey } from '../../sort';

// Sorted paging works out each sort value once per row (graphql/sort.ts): a sort key
// that counts its own calls is called at most once for each row the list holds, on the
// first page and on a page after a cursor.

beforeAll(async () => {
  await db.execute(sql`CREATE SEQUENCE IF NOT EXISTS sort_once_calls`);
  await db.execute(sql`
    CREATE OR REPLACE FUNCTION sort_once_value(x uuid) RETURNS int
    LANGUAGE plpgsql VOLATILE AS $$ BEGIN PERFORM nextval('sort_once_calls'); RETURN 1; END $$
  `);
});

afterAll(async () => {
  await db.execute(sql`DROP FUNCTION IF EXISTS sort_once_value(uuid)`);
  await db.execute(sql`DROP SEQUENCE IF EXISTS sort_once_calls`);
});

beforeEach(resetDb);

// The sequence's value; reading it counts one call, which `calls` takes off.
async function counter(): Promise<number> {
  const [row] = await db.execute<{ n: string }>(sql`SELECT nextval('sort_once_calls') AS n`);
  return Number(row!.n);
}

async function calls(run: () => Promise<unknown>): Promise<number> {
  const before = await counter();
  await run();
  return (await counter()) - before - 1;
}

const counted: SortKey = {
  sql: sql`sort_once_value(${user.id})`,
  order: 'asc',
  nulls: 'last',
  type: 'number',
};

const page = (after?: string) =>
  paginateSorted(
    { first: 3, after },
    [counted],
    newestFirst(sql`${user.createdAt}`),
    sql`${user.id}`,
    undefined,
    (where, values) => db.select(values).from(user).where(where),
    (ids) => db.select(getTableColumns(user)).from(user).where(inArray(user.id, ids)),
    (row) => row.id,
  );

describe('sorted paging', () => {
  it('works out each sort value at most once per row', async () => {
    for (let i = 0; i < 7; i++) await signUpTestUser({ name: `U${i}` });
    const rows = (await db.select({ id: user.id }).from(user)).length;

    let first!: Awaited<ReturnType<typeof page>>;
    expect(await calls(async () => (first = await page()))).toBeLessThanOrEqual(rows);
    expect(first.nodes).toHaveLength(3);

    let second!: Awaited<ReturnType<typeof page>>;
    expect(
      await calls(async () => (second = await page(first.pageInfo.endCursor!))),
    ).toBeLessThanOrEqual(rows);
    expect(second.nodes).toHaveLength(3);
    expect(second.nodes.filter((id) => first.nodes.includes(id))).toEqual([]);
  });

  it('keeps the cursor format: the sort values then the id', async () => {
    for (let i = 0; i < 4; i++) await signUpTestUser({ name: `U${i}` });
    const { edges } = await page();
    const values = JSON.parse(Buffer.from(edges[0]!.cursor, 'base64url').toString());
    expect(values).toHaveLength(3);
    expect(values[0]).toBe(1);
    expect(values[2]).toBe(edges[0]!.node);
  });
});
