import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fetchAllPages, fetchPagesUpTo } from '../fetchAllPages';

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

describe('fetchPagesUpTo', () => {
  const page = (from: number, size: number, more: boolean) => ({
    nodes: Array.from({ length: size }, (_, i) => from + i),
    pageInfo: { hasNextPage: more, endCursor: more ? `c${from + size}` : null },
  });

  it('stops at the limit and reports that more items exist', async () => {
    const sizes: number[] = [];
    const result = await fetchPagesUpTo(
      async (after, first) => {
        sizes.push(first);
        const from = after ? Number(after.slice(1)) : 0;
        return page(from, first, true);
      },
      5,
      2,
    );
    assert.deepEqual(result.nodes, [0, 1, 2, 3, 4]);
    assert.equal(result.capped, true);
    assert.deepEqual(sizes, [2, 2, 1]);
  });

  it('returns everything when the list ends before the limit', async () => {
    const result = await fetchPagesUpTo(
      async (after, first) => {
        const from = after ? Number(after.slice(1)) : 0;
        return page(from, first, from + first < 3);
      },
      5,
      2,
    );
    assert.deepEqual(result.nodes, [0, 1, 2, 3]);
    assert.equal(result.capped, false);
  });
});
