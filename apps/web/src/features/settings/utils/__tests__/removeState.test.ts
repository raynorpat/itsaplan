import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { removeState } from '../removeState';

// Removing a state moves its issues to the chosen state (issueBatchUpdate in groups of
// 50, a refused group retried one issue at a time), then archives the state. When any
// issue does not move, the state is left in place and the failures are reported.

const ids = (n: number) => Array.from({ length: n }, (_, i) => `i${i}`);

function run(failing: Set<string> = new Set()) {
  const calls = { chunks: 0, archived: 0 };
  return {
    calls,
    run: {
      moveChunk: async (group: string[]) => {
        calls.chunks += 1;
        if (group.some((id) => failing.has(id))) throw new Error('refused');
      },
      moveOne: async (id: string) => {
        if (failing.has(id)) throw new Error(`cannot move ${id}`);
      },
      archive: async () => {
        calls.archived += 1;
      },
    },
  };
}

describe('removeState', () => {
  it('archives a state with no issues', async () => {
    const r = run();
    const result = await removeState([], r.run);
    assert.equal(result.archived, true);
    assert.equal(r.calls.archived, 1);
    assert.equal(r.calls.chunks, 0);
  });

  it('moves every issue in groups of 50, then archives', async () => {
    const r = run();
    const result = await removeState(ids(120), r.run);
    assert.equal(r.calls.chunks, 3);
    assert.equal(result.moved.length, 120);
    assert.deepEqual(result.failed, []);
    assert.equal(result.archived, true);
  });

  it('does not archive when an issue fails to move, and names it', async () => {
    const r = run(new Set(['i77']));
    const result = await removeState(ids(120), r.run);
    assert.equal(result.archived, false);
    assert.equal(r.calls.archived, 0);
    assert.deepEqual(result.failed, [{ id: 'i77', message: 'cannot move i77' }]);
    assert.equal(result.moved.length, 119);
  });
});
