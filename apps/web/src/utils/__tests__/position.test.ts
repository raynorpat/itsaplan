import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { positionBetween, positionForMove } from '../position';

// Sparse positions: a moved or new item gets a value between its new neighbours, so
// only that item is written.

describe('positionBetween', () => {
  it('is the midpoint between two neighbours', () => {
    assert.equal(positionBetween(1000, 2000), 1500);
  });
  it('is one step below the first and above the last', () => {
    assert.equal(positionBetween(undefined, 1000), 0);
    assert.equal(positionBetween(1000, undefined), 2000);
  });
  it('is one step in an empty list', () => {
    assert.equal(positionBetween(undefined, undefined), 1000);
  });
  it('takes another step', () => {
    assert.equal(positionBetween(undefined, 1, 1), 0);
    assert.equal(positionBetween(4, undefined, 1), 5);
    assert.equal(positionBetween(undefined, undefined, 1), 1);
  });
});

describe('positionForMove', () => {
  const positions = [1, 2, 4];

  it('moves down between the next two', () => {
    assert.equal(positionForMove(positions, 0, 1), 3);
  });
  it('moves up between the previous two', () => {
    assert.equal(positionForMove(positions, 2, 1), 1.5);
  });
  it('moves to the top one step below the first', () => {
    assert.equal(positionForMove(positions, 1, 0, 1), 0);
    assert.equal(positionForMove(positions, 1, 0), -999);
  });
  it('moves to the bottom one step past the last', () => {
    assert.equal(positionForMove(positions, 0, 2, 1), 5);
    assert.equal(positionForMove(positions, 0, 2), 1004);
  });
  it('keeps the position of a move onto itself', () => {
    assert.equal(positionForMove(positions, 1, 1), 2);
  });
  it('places a new item (`from` is the list length) after the last', () => {
    assert.equal(positionForMove(positions, 3, 3, 1), 5);
    assert.equal(positionForMove([], 0, 0), 1000);
  });
});
