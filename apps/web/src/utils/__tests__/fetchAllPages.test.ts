import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fetchAllPages } from '../fetchAllPages';

// Loading a whole list from a GraphQL connection: every page in order, following
// endCursor, stopping when hasNextPage is false.

describe('fetchAllPages', () => {
  it('follows the cursor through every page in order', async () => {
    const pages = [
      { nodes: [1, 2], pageInfo: { hasNextPage: true, endCursor: 'a' } },
      { nodes: [3, 4], pageInfo: { hasNextPage: true, endCursor: 'b' } },
      { nodes: [5], pageInfo: { hasNextPage: false, endCursor: 'c' } },
    ];
    const calls: (string | null)[] = [];
    const all = await fetchAllPages(async (after, first) => {
      calls.push(after);
      assert.equal(first, 250);
      return pages[calls.length - 1]!;
    });
    assert.deepEqual(all, [1, 2, 3, 4, 5]);
    assert.deepEqual(calls, [null, 'a', 'b']);
  });

  it('stops after one page when there is no next page', async () => {
    let calls = 0;
    const all = await fetchAllPages(async () => {
      calls += 1;
      return { nodes: ['x'], pageInfo: { hasNextPage: false, endCursor: null } };
    }, 10);
    assert.deepEqual(all, ['x']);
    assert.equal(calls, 1);
  });
});
