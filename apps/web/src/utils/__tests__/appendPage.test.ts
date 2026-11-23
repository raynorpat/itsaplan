import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { appendPage } from '../appendPage';

// "Load more" pages appended to the loaded rows.

describe('appendPage', () => {
  it('appends a page in order', () => {
    const out = appendPage([{ id: 'a' }, { id: 'b' }], [{ id: 'c' }, { id: 'd' }]);
    assert.deepEqual(
      out.map((p) => p.id),
      ['a', 'b', 'c', 'd'],
    );
  });

  it('drops rows a page repeats and keeps the first position', () => {
    // A project created between pages shifts the next page by one.
    const out = appendPage([{ id: 'a' }, { id: 'b' }], [{ id: 'b' }, { id: 'c' }]);
    assert.deepEqual(
      out.map((p) => p.id),
      ['a', 'b', 'c'],
    );
  });

  it('takes the newer copy of a repeated row', () => {
    const out = appendPage([{ id: 'a', name: 'old' }], [{ id: 'a', name: 'new' }]);
    assert.deepEqual(out, [{ id: 'a', name: 'new' }]);
  });
});
