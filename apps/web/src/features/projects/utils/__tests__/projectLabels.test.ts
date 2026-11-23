import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canManageProjectLabels } from '../projectLabels';

// Managing project labels needs the organization's labelManagementRole (Linear's
// UserRoleType: `user` is a member) or higher.

describe('canManageProjectLabels', () => {
  it('lets a member manage when the minimum is user', () => {
    assert.equal(canManageProjectLabels('member', 'user'), true);
  });
  it('refuses a member when the minimum is admin', () => {
    assert.equal(canManageProjectLabels('member', 'admin'), false);
  });
  it('lets an admin and an owner manage when the minimum is admin', () => {
    assert.equal(canManageProjectLabels('admin', 'admin'), true);
    assert.equal(canManageProjectLabels('owner', 'admin'), true);
  });
  it('refuses a guest always', () => {
    assert.equal(canManageProjectLabels('guest', 'user'), false);
  });
  it('refuses while the role or the setting is unknown', () => {
    assert.equal(canManageProjectLabels(null, 'user'), false);
    assert.equal(canManageProjectLabels('owner', undefined), false);
  });
});
