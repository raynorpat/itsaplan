import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sortOrderForMove } from '../milestoneOrder';

// Moving a milestone gives it a sortOrder between its new neighbours, so only the
// moved milestone is written.

const list = [
  { id: 'a', sortOrder: 1 },
  { id: 'b', sortOrder: 2 },
  { id: 'c', sortOrder: 4 },
];

describe('sortOrderForMove', () => {
  it('moves down between the next two', () => {
    assert.equal(sortOrderForMove(list, 0, 1), 3);
  });

  it('moves up between the previous two', () => {
    assert.equal(sortOrderForMove(list, 2, 1), 1.5);
  });

  it('moves to the top below the first', () => {
    assert.equal(sortOrderForMove(list, 1, 0), 0);
  });

  it('moves to the bottom past the last', () => {
    assert.equal(sortOrderForMove(list, 0, 2), 5);
  });

  it('keeps the order of a move onto itself', () => {
    assert.equal(sortOrderForMove(list, 1, 1), 2);
  });
});

describe('sortOrderForMove for a new milestone', () => {
  it('puts it after the last', () => {
    assert.equal(sortOrderForMove(list, list.length, list.length), 5);
  });

  it('starts at 0 in an empty list', () => {
    assert.equal(sortOrderForMove([], 0, 0), 0);
  });
});
