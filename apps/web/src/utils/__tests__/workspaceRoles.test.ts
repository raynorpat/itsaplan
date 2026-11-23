import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canSeeInitiatives } from '@/utils/workspaceRoles';

// Linear's guests have no initiatives; owners, admins and members see them.

describe('canSeeInitiatives', () => {
  it('lets owners, admins and members see initiatives', () => {
    assert.equal(canSeeInitiatives('owner'), true);
    assert.equal(canSeeInitiatives('admin'), true);
    assert.equal(canSeeInitiatives('member'), true);
  });

  it('hides initiatives from guests and while the role is unknown', () => {
    assert.equal(canSeeInitiatives('guest'), false);
    assert.equal(canSeeInitiatives(null), false);
  });
});
