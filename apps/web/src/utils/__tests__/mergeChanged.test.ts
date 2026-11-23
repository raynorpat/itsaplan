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

  it('never replaces a cached item with an older version of it', () => {
    // A changed-since response fetched before the viewer's own edit landed must not
    // undo that edit.
    const at = (id: string, updatedAt: string) => ({ id, updatedAt });
    const current = [at('a', '2026-11-23T10:00:05Z')];
    const merged = mergeChanged(current, [at('a', '2026-11-23T10:00:01Z')], (x) => x.updatedAt);
    assert.equal(merged, current);
    const newer = mergeChanged(current, [at('a', '2026-11-23T10:00:09Z')], (x) => x.updatedAt);
    assert.deepEqual(newer, [at('a', '2026-11-23T10:00:09Z')]);
  });
});
