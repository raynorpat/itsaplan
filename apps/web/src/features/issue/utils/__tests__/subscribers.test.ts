import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isSubscribed, orderSubscribers } from '../subscribers';

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
