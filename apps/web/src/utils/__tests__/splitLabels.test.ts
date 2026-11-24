import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { splitLabels } from '@/utils/labels';

// Labels settings list the active labels in their groups and the retired ones in a
// section of their own. Retiring only hides a label from the pickers: issues keep it.
describe('splitLabels', () => {
  it('splits active and retired labels, keeping order', () => {
    const labels = [
      { id: 'a', retiredAt: null },
      { id: 'b', retiredAt: '2026-11-20T00:00:00Z' },
      { id: 'c' },
      { id: 'd', retiredAt: '2026-11-21T00:00:00Z' },
    ];
    const { active, retired } = splitLabels(labels);
    assert.deepEqual(
      active.map((l) => l.id),
      ['a', 'c'],
    );
    assert.deepEqual(
      retired.map((l) => l.id),
      ['b', 'd'],
    );
  });

  it('returns two empty lists for no labels', () => {
    assert.deepEqual(splitLabels([]), { active: [], retired: [] });
  });
});
