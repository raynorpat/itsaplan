import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { tryItems } from '@/utils/sidebarModel';
import { meetsMinimumRole } from '@/utils/workspaceRoles';

// The sidebar's "Try" section, as in Linear: Import issues for owners and admins (the
// API's import rule), Invite people for those the organization's invitationsRole
// allows. With neither, the section is hidden.

describe('tryItems', () => {
  it('gives an owner both items', () => {
    assert.deepEqual(tryItems({ role: 'owner', canInvite: true }), ['import', 'invite']);
  });
  it('gives an admin import even without invite rights', () => {
    assert.deepEqual(tryItems({ role: 'admin', canInvite: false }), ['import']);
  });
  it('gives a member with invite rights only invite', () => {
    assert.deepEqual(tryItems({ role: 'member', canInvite: true }), ['invite']);
  });
  it('gives a member without invite rights nothing', () => {
    assert.deepEqual(tryItems({ role: 'member', canInvite: false }), []);
  });
  it('gives a guest nothing', () => {
    assert.deepEqual(tryItems({ role: 'guest', canInvite: true }), []);
  });
  it('gives nothing while the role is unknown', () => {
    assert.deepEqual(tryItems({ role: null, canInvite: true }), []);
  });
});

describe('meetsMinimumRole', () => {
  it('reads Linear’s `user` as a member', () => {
    assert.equal(meetsMinimumRole('member', 'user'), true);
    assert.equal(meetsMinimumRole('member', 'admin'), false);
  });
  it('refuses a guest, an unknown role and an unknown setting', () => {
    assert.equal(meetsMinimumRole('guest', 'guest'), false);
    assert.equal(meetsMinimumRole(null, 'user'), false);
    assert.equal(meetsMinimumRole('owner', undefined), false);
    assert.equal(meetsMinimumRole('owner', 'nonsense'), false);
  });
});
