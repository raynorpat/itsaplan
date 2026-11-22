import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mergeChanged } from '../mergeChanged';

// mergeChanged: folds the nodes a changed-since query returned into the cached list.

const n = (id: string, v = 0) => ({ id, v });

describe('mergeChanged', () => {
  it('replaces by id, appends new, keeps order and never duplicates', () => {
    const current = [n('a'), n('b'), n('c')];
    const merged = mergeChanged(current, [n('b', 1), n('d'), n('b', 2)]);
    assert.deepEqual(merged, [n('a'), n('b', 2), n('c'), n('d')]);
  });

  it('returns the same list when nothing changed', () => {
    const current = [n('a')];
    assert.equal(mergeChanged(current, []), current);
  });
});
