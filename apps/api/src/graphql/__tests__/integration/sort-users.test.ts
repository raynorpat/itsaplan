import { beforeEach, describe, expect, it } from 'bun:test';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { gqlData, type Data } from '../../../__tests__/helpers/graphql';
import { gql } from '../../../__tests__/helpers/linear';

// Linear's `sort` on user lists (UserSortInput) and the sorted forward paging every
// sorted list shares (graphql/sort.ts).

beforeEach(resetDb);

const USERS = `query ($sort: [UserSortInput!], $first: Int, $after: String, $last: Int) {
  users(sort: $sort, first: $first, after: $after, last: $last) {
    nodes { id name }
    pageInfo { hasNextPage endCursor }
  }
}`;

async function names(as: { cookie: string }, sort: unknown): Promise<string[]> {
  const data = await gqlData<Data>(as, USERS, { sort });
  return data.users.nodes.map((u: { name: string }) => u.name);
}

describe('user sorts', () => {
  it('orders by name, ascending and descending', async () => {
    const owner = await signUpTestUser({ name: 'Mia' });
    await signUpTestUser({ name: 'Ann' });
    await signUpTestUser({ name: 'Zed' });
    expect(await names(owner, [{ name: { order: 'Ascending' } }])).toEqual(['Ann', 'Mia', 'Zed']);
    expect(await names(owner, [{ name: { order: 'Descending' } }])).toEqual(['Zed', 'Mia', 'Ann']);
    expect(await names(owner, [{ displayName: { order: 'Ascending' } }])).toEqual([
      'Ann',
      'Mia',
      'Zed',
    ]);
  });

  it('pages through equal values without repeating or skipping a user', async () => {
    const owner = await signUpTestUser({ name: 'Same' });
    for (let i = 0; i < 6; i++) await signUpTestUser({ name: 'Same' });
    const seen: string[] = [];
    let after: string | null = null;
    const sizes: number[] = [];
    for (;;) {
      const data: Data = await gqlData<Data>(owner, USERS, {
        sort: [{ name: { order: 'Ascending' } }],
        first: 3,
        after,
      });
      sizes.push(data.users.nodes.length);
      seen.push(...data.users.nodes.map((u: { id: string }) => u.id));
      if (!data.users.pageInfo.hasNextPage) break;
      after = data.users.pageInfo.endCursor;
    }
    expect(sizes).toEqual([3, 3, 1]);
    expect(new Set(seen).size).toBe(7);
  });

  it('refuses backward paging with a sort', async () => {
    const owner = await signUpTestUser({ name: 'Owner' });
    const res = await gql({ cookie: owner.cookie }, USERS, {
      sort: [{ name: { order: 'Ascending' } }],
      last: 2,
    });
    expect(res.body.errors?.[0]?.extensions?.code).toBe('INVALID_INPUT');
  });

  it('refuses an unknown sort key', async () => {
    const owner = await signUpTestUser({ name: 'Owner' });
    const res = await gql({ cookie: owner.cookie }, USERS, { sort: [{ bogus: {} }] });
    expect(res.body.errors?.length).toBeGreaterThan(0);
  });

  it('refuses two keys in one sort object', async () => {
    const owner = await signUpTestUser({ name: 'Owner' });
    const res = await gql({ cookie: owner.cookie }, USERS, {
      sort: [{ name: { order: 'Ascending' }, displayName: { order: 'Ascending' } }],
    });
    expect(res.body.errors?.[0]?.extensions?.code).toBe('INVALID_INPUT');
  });
});
