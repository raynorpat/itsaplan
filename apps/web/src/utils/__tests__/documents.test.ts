import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { documentTitle, sortDocuments } from '../documents';
import { isSubscribed, orderSubscribers } from '../subscribers';

describe('documentTitle', () => {
  it('trims the title', () => {
    assert.equal(documentTitle('  Spec  '), 'Spec');
  });

  it('falls back to Untitled for an empty title', () => {
    assert.equal(documentTitle('   '), 'Untitled');
    assert.equal(documentTitle(null), 'Untitled');
  });
});

describe('sortDocuments', () => {
  it('lists the most recently updated first, then by title', () => {
    const docs = [
      { id: 'a', title: 'B', updatedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'b', title: 'A', updatedAt: '2026-01-03T00:00:00.000Z' },
      { id: 'c', title: 'A', updatedAt: '2026-01-01T00:00:00.000Z' },
    ];
    assert.deepEqual(
      sortDocuments(docs).map((d) => d.id),
      ['b', 'c', 'a'],
    );
  });
});

describe('subscribers', () => {
  const users = [
    { id: 'u2', name: 'Zed' },
    { id: 'u1', name: 'Amy' },
    { id: 'me', name: 'Moe' },
  ];

  it('puts the viewer first, then by name', () => {
    assert.deepEqual(
      orderSubscribers(users, 'me').map((u) => u.id),
      ['me', 'u1', 'u2'],
    );
  });

  it('tells whether the viewer is subscribed', () => {
    assert.equal(isSubscribed(users, 'me'), true);
    assert.equal(isSubscribed(users, 'nobody'), false);
    assert.equal(isSubscribed(users, null), false);
  });
});
