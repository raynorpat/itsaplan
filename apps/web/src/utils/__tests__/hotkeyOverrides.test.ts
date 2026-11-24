import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyOverrides, DEFAULT_COMBOS } from '@/utils/hotkeys';

describe('applyOverrides', () => {
  it('reads a binding stored for the former Table layout as the List layout', () => {
    const combos = applyOverrides(DEFAULT_COMBOS, { 'view.table': 'shift+l' });
    assert.equal(combos['view.list'], 'shift+l');
  });

  it('prefers a binding stored under the List id', () => {
    const combos = applyOverrides(DEFAULT_COMBOS, {
      'view.table': 'shift+l',
      'view.list': 'shift+m',
    });
    assert.equal(combos['view.list'], 'shift+m');
  });
});
