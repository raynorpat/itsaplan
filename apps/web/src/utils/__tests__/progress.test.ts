import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { progressPercent } from '../progress';

describe('progressPercent', () => {
  it('rounds down to a whole percent, as the cycle pages do', () => {
    assert.equal(progressPercent(0), 0);
    assert.equal(progressPercent(0.006), 0);
    assert.equal(progressPercent(0.4286), 42);
    assert.equal(progressPercent(1), 100);
  });

  it('never shows 100% for an unfinished project', () => {
    assert.equal(progressPercent(0.996), 99);
    assert.equal(progressPercent(0.999), 99);
  });
});
