import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { positionForMove } from '../statePosition';

// The API places a state before the first other state whose position is greater than
// the one sent (workflowStateUpdate `position`), so the value sent lies between the
// moved state's new neighbours.

const group = [
  { id: 'a', position: 0 },
  { id: 'b', position: 1 },
  { id: 'c', position: 2 },
  { id: 'd', position: 3 },
];

describe('positionForMove', () => {
  it('moves down into the middle: between the new neighbours', () => {
    // [b, c, a, d]: a sits between c and d.
    assert.equal(positionForMove(group, 0, 2), 2.5);
  });

  it('moves up into the middle', () => {
    // [a, c, b, d]: c sits between a and b.
    assert.equal(positionForMove(group, 2, 1), 0.5);
  });

  it('moves to first: below the current first', () => {
    assert.equal(positionForMove(group, 3, 0), -1);
  });

  it('moves to last: above the current last', () => {
    assert.equal(positionForMove(group, 0, 3), 4);
  });
});
