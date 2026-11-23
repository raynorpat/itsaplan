import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { groupReactions } from '@/utils/reactions';

// Reactions grouped by emoji for the chip row: in the order each emoji first
// appears, with the count, the names of who reacted, and the viewer's own reaction
// (its id, so a click can remove it).

const r = (id: string, emoji: string, userId: string, name: string) => ({
  id,
  emoji,
  user: { id: userId, name },
});

describe('groupReactions', () => {
  it('groups by emoji in first-seen order with counts and names', () => {
    const groups = groupReactions(
      [r('a', '👍', 'u1', 'Ann'), r('b', '🎉', 'u2', 'Bo'), r('c', '👍', 'u2', 'Bo')],
      'u3',
    );
    assert.deepEqual(groups, [
      { emoji: '👍', count: 2, users: ['Ann', 'Bo'], mineId: null },
      { emoji: '🎉', count: 1, users: ['Bo'], mineId: null },
    ]);
  });

  it("marks the viewer's own reaction with its id", () => {
    const groups = groupReactions([r('a', '👍', 'u1', 'Ann'), r('b', '👍', 'u3', 'Me')], 'u3');
    assert.equal(groups[0]!.mineId, 'b');
  });

  it('keeps a reaction whose user is gone, without a name', () => {
    const groups = groupReactions([{ id: 'a', emoji: '👀', user: null }], 'u1');
    assert.deepEqual(groups, [{ emoji: '👀', count: 1, users: [], mineId: null }]);
  });

  it('returns nothing for no reactions', () => {
    assert.deepEqual(groupReactions([], 'u1'), []);
  });
});
