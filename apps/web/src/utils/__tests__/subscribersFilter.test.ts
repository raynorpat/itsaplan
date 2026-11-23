import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { matchesSubscribers, resolveSubscriberValues } from '../filters';

// The subscribers filter: the board asks the server which issues have one of the
// chosen subscribers and filters its loaded issues by that set.

describe('subscribers filter', () => {
  it('keeps issues in the set for "is" and the others for "is not"', () => {
    const set = new Set(['i1', 'i2']);
    assert.equal(matchesSubscribers('i1', set, 'is'), true);
    assert.equal(matchesSubscribers('i3', set, 'is'), false);
    assert.equal(matchesSubscribers('i1', set, 'is_not'), false);
    assert.equal(matchesSubscribers('i3', set, 'is_not'), true);
  });

  it('constrains nothing while the set is loading', () => {
    assert.equal(matchesSubscribers('i1', undefined, 'is'), true);
    assert.equal(matchesSubscribers('i1', undefined, 'is_not'), true);
  });

  it('resolves "me" to the viewer', () => {
    assert.deepEqual(resolveSubscriberValues(['me', 'u2', null], 'u1'), ['u1', 'u2']);
  });
});
