import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { positionBetween, positionForMove } from '../order';

describe('positionBetween', () => {
  it('is 1000 in an empty list', () => {
    assert.equal(positionBetween(undefined, undefined), 1000);
  });
  it('is 1000 after the last item', () => {
    assert.equal(positionBetween(1000, undefined), 2000);
  });
});

describe('positionForMove', () => {
  const list = [
    { id: 'a', position: 1000 },
    { id: 'b', position: 2000 },
    { id: 'c', position: 3000 },
  ];
  it('moves an item to the top', () => {
    assert.equal(positionForMove(list, 2, 0), 0);
  });
  it('moves an item to the bottom', () => {
    assert.equal(positionForMove(list, 0, 2), 4000);
  });
  it('moves an item between two others', () => {
    assert.equal(positionForMove(list, 0, 1), 2500);
  });
});
