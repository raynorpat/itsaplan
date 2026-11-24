import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GO_TARGETS, goSequenceStep } from '@/utils/goSequence';

describe('goSequenceStep', () => {
  it('goes to the inbox on G then I', () => {
    const first = goSequenceStep(null, 'g', 1000);
    assert.equal(first.target, null);
    assert.equal(goSequenceStep(first.pending, 'i', 1500).target, 'inbox');
  });

  it('maps G M to My issues and G P to Projects', () => {
    const g = goSequenceStep(null, 'g', 0).pending;
    assert.equal(goSequenceStep(g, 'm', 10).target, 'my-issues');
    assert.equal(goSequenceStep(g, 'p', 10).target, 'projects');
    assert.deepEqual(Object.keys(GO_TARGETS).sort(), ['i', 'm', 'p']);
  });

  it('forgets the G after a second', () => {
    const g = goSequenceStep(null, 'g', 0).pending;
    const late = goSequenceStep(g, 'i', 1001);
    assert.equal(late.target, null);
    assert.equal(late.pending, null);
  });

  it('ignores a second key that is not a target', () => {
    const g = goSequenceStep(null, 'g', 0).pending;
    const res = goSequenceStep(g, 'x', 10);
    assert.deepEqual(res, { pending: null, target: null });
  });

  it('does nothing for a letter without a G first', () => {
    assert.deepEqual(goSequenceStep(null, 'i', 0), { pending: null, target: null });
  });
});
