import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canSendToRequesters } from '../updateSharing';

// "Send to requesters" on a posted update: for its author or an admin, until it is sent.

describe('canSendToRequesters', () => {
  it('lets the author send an update not sent yet', () => {
    assert.equal(canSendToRequesters({ shared: false, own: true, role: 'member' }), true);
  });

  it('lets an admin or owner send someone else’s update', () => {
    assert.equal(canSendToRequesters({ shared: false, own: false, role: 'admin' }), true);
    assert.equal(canSendToRequesters({ shared: false, own: false, role: 'owner' }), true);
  });

  it('refuses another member, a guest and an update already sent', () => {
    assert.equal(canSendToRequesters({ shared: false, own: false, role: 'member' }), false);
    assert.equal(canSendToRequesters({ shared: false, own: true, role: 'guest' }), false);
    assert.equal(canSendToRequesters({ shared: true, own: true, role: 'admin' }), false);
  });
});
