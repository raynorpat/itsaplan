import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { patchIssueInList } from '../boardCache';
import { chunk, runBulk } from '../bulk';

// Board writes: patching the cached issue list from a mutation's returned issue, and
// running a bulk action in chunks while reporting exactly which issues failed.

const issue = (id: string, stateId = 's1', position = 1000) =>
  ({ id, stateId, position, identifier: `MKT-${id}` }) as unknown as Parameters<
    typeof patchIssueInList
  >[0][number];

describe('patchIssueInList', () => {
  it('replaces the issue by id and keeps the others', () => {
    const list = [issue('1'), issue('2'), issue('3')];
    const next = patchIssueInList(list, issue('2', 's2', 500));
    assert.deepEqual(
      next.map((i) => [i.id, i.stateId, i.position]),
      [
        ['1', 's1', 1000],
        ['2', 's2', 500],
        ['3', 's1', 1000],
      ],
    );
  });

  it('returns the same list when the issue is not on the board', () => {
    const list = [issue('1')];
    assert.equal(patchIssueInList(list, issue('9')), list);
  });
});

describe('chunk', () => {
  it('splits ids into groups of the given size', () => {
    const ids = Array.from({ length: 120 }, (_, i) => String(i));
    assert.deepEqual(
      chunk(ids, 50).map((c) => c.length),
      [50, 50, 20],
    );
  });
});

describe('runBulk', () => {
  it('reports exactly the failing issue and applies the rest', async () => {
    const ids = Array.from({ length: 120 }, (_, i) => String(i));
    const bad = '73';
    const ran: string[] = [];
    const result = await runBulk(ids, {
      size: 50,
      // A batch fails whole when one of its issues is refused.
      runChunk: async (group) => {
        if (group.includes(bad)) throw new Error('refused');
        ran.push(...group);
      },
      // Then each issue of that batch is tried on its own.
      runOne: async (id) => {
        if (id === bad) throw new Error('No access to that project');
        ran.push(id);
      },
    });
    assert.deepEqual(result.failed, [{ id: bad, message: 'No access to that project' }]);
    assert.equal(result.done.length, 119);
    assert.equal(new Set(result.done).size, 119);
    assert.ok(!result.done.includes(bad));
    assert.equal(ran.length, 119);
  });

  it('runs every issue on its own when there is no batch call', async () => {
    const result = await runBulk(['a', 'b', 'c'], {
      size: 1,
      runOne: async (id) => {
        if (id === 'b') throw new Error('gone');
      },
    });
    assert.deepEqual(result.done, ['a', 'c']);
    assert.deepEqual(result.failed, [{ id: 'b', message: 'gone' }]);
  });
});
