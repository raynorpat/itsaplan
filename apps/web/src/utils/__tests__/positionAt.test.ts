import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { positionAt } from '../team';

// positionAt: the sortOrder a dropped card gets from its new neighbours.

const at = (...positions: number[]) => positions.map((position) => ({ position })) as never[];

describe('positionAt', () => {
  it('is the midpoint between two neighbours', () => {
    assert.equal(positionAt(at(1000, 2000), 1), 1500);
  });
  it('is 1000 above the first card', () => {
    assert.equal(positionAt(at(1000, 2000), 0), 0);
  });
  it('is 1000 below the last card', () => {
    assert.equal(positionAt(at(1000, 2000), 2), 3000);
  });
  it('is 1000 in an empty column', () => {
    assert.equal(positionAt(at(), 0), 1000);
  });
});
