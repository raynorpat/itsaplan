import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canManageLabels } from '@/utils/labelManagement';

// Managing project labels needs the organization's labelManagementRole (Linear's
// UserRoleType: `user` is a member) or higher.

describe('canManageLabels', () => {
  it('lets a member manage when the minimum is user', () => {
    assert.equal(canManageLabels('member', 'user'), true);
  });
  it('refuses a member when the minimum is admin', () => {
    assert.equal(canManageLabels('member', 'admin'), false);
  });
  it('lets an admin and an owner manage when the minimum is admin', () => {
    assert.equal(canManageLabels('admin', 'admin'), true);
    assert.equal(canManageLabels('owner', 'admin'), true);
  });
  it('refuses a guest always', () => {
    assert.equal(canManageLabels('guest', 'user'), false);
  });
  it('refuses while the role or the setting is unknown', () => {
    assert.equal(canManageLabels(null, 'user'), false);
    assert.equal(canManageLabels('owner', undefined), false);
  });
});
