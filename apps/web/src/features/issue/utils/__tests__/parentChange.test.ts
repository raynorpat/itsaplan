import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parentChangeText } from '../parentChange';
import { historyToFeedItems } from '../feed';

// Parent changes in the issue activity: the line the feed shows, and the history
// entry mapped to it (a parent that no longer exists reads "an issue").

describe('parentChangeText', () => {
  it('phrases set, change and removal', () => {
    assert.equal(parentChangeText(null, 'ENG-3'), 'set parent to ENG-3');
    assert.equal(parentChangeText('ENG-3', 'ENG-5'), 'changed parent from ENG-3 to ENG-5');
    assert.equal(parentChangeText('ENG-3', null), 'removed parent ENG-3');
  });
});

describe('historyToFeedItems for parent changes', () => {
  const base = {
    id: 'h1',
    createdAt: '2026-11-24T10:00:00.000Z',
    actor: { id: 'u1', name: 'Ann' },
  };

  it('maps the parent identifiers', () => {
    const [row] = historyToFeedItems(
      {
        ...base,
        fromParentId: 'p1',
        fromParent: { identifier: 'ENG-3' },
        toParentId: 'p2',
        toParent: { identifier: 'ENG-5' },
      },
      'i1',
    );
    assert.equal(row?.action, 'parent');
    assert.equal(row?.fromText, 'ENG-3');
    assert.equal(row?.toText, 'ENG-5');
  });

  it('names a parent that no longer exists "an issue"', () => {
    const [row] = historyToFeedItems(
      { ...base, fromParentId: 'gone', fromParent: null, toParentId: null },
      'i1',
    );
    assert.equal(row?.action, 'parent');
    assert.equal(parentChangeText(row!.fromText, row!.toText), 'removed parent an issue');
  });
});
