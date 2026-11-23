import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cyclesVisible } from '@/utils/cycles';

// Cycle controls appear only for a team with cycles turned on.

describe('cyclesVisible', () => {
  it('is true when the team has cycles on', () => {
    assert.equal(cyclesVisible({ cycles: { enabled: true } }), true);
  });

  it('is false when the team has cycles off', () => {
    assert.equal(cyclesVisible({ cycles: { enabled: false } }), false);
  });

  it('is false while the team is not loaded', () => {
    assert.equal(cyclesVisible(null), false);
    assert.equal(cyclesVisible(undefined), false);
  });
});
