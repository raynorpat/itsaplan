import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { commentToFeedItem } from '@/utils/commentThreads';
import { mentionCandidates } from '@/utils/mentionCandidates';

// App users (OAuth applications installed with actor=app) are marked in comments and
// history, and offered for @-mentions only when their install allows it.
describe('commentToFeedItem', () => {
  const base = {
    id: 'c1',
    body: 'hi',
    createdAt: '2026-01-01T00:00:00Z',
    editedAt: null,
    resolvedAt: null,
    parentId: null,
  };

  it('marks a comment written by an app user', () => {
    const item = commentToFeedItem({ ...base, user: { id: 'u1', name: 'Bot', app: true } }, 'i1');
    assert.equal(item.actorIsApp, true);
  });

  it('does not mark a comment written by a person', () => {
    const item = commentToFeedItem({ ...base, user: { id: 'u2', name: 'Ann' } }, 'i1');
    assert.equal(item.actorIsApp, false);
  });
});

describe('mentionCandidates', () => {
  const people = [{ userId: 'p1', name: 'Ann', email: 'ann@x', image: null }];

  it('adds only mentionable app users, marked as apps, after the people', () => {
    const result = mentionCandidates(people, [
      { id: 'a1', name: 'Deploy bot', avatarUrl: null, isMentionable: true, isAssignable: false },
      { id: 'a2', name: 'Silent bot', avatarUrl: null, isMentionable: false, isAssignable: false },
    ]);
    assert.deepEqual(
      result.map((c) => [c.userId, c.app ?? false]),
      [
        ['p1', false],
        ['a1', true],
      ],
    );
  });

  it('is the people alone without app users', () => {
    assert.deepEqual(mentionCandidates(people, []), people);
  });
});
