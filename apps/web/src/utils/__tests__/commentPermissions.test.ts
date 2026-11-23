import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canDeleteComment, canEditComment, canResolveThread } from '@/utils/commentPermissions';

// The comment controls follow the API's rules: only the author edits; the author or
// a team manager deletes; anyone signed in who sees the thread resolves it, on its
// root comment only.

const root = { actorUserId: 'u1', parentId: null };
const reply = { actorUserId: 'u1', parentId: 'c1' };

describe('comment permissions', () => {
  it('lets only the author edit', () => {
    assert.equal(canEditComment('u1', root), true);
    assert.equal(canEditComment('u2', root), false);
    assert.equal(canEditComment(null, root), false);
    assert.equal(canEditComment('u1', { actorUserId: null, parentId: null }), false);
  });

  it('lets the author or a team manager delete', () => {
    assert.equal(canDeleteComment('u1', root, false), true);
    assert.equal(canDeleteComment('u2', root, false), false);
    assert.equal(canDeleteComment('u2', root, true), true);
    assert.equal(canDeleteComment(null, root, true), false);
  });

  it('resolves only a root comment, for anyone signed in', () => {
    assert.equal(canResolveThread('u2', root), true);
    assert.equal(canResolveThread('u2', reply), false);
    assert.equal(canResolveThread(null, root), false);
  });
});
