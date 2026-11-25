import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createChangedSinceGuard } from '../changedSinceGuard';

// The guard that keeps a changed-since response from landing after a newer full
// reload of the same list (which would put back an item the reload had dropped).

describe('changed-since guard', () => {
  it('accepts a response when nothing reloaded the list meanwhile', () => {
    const guard = createChangedSinceGuard();
    const token = guard.begin('list');
    assert.equal(guard.isCurrent('list', token), true);
  });

  it('discards a response that started before a full reload', () => {
    const guard = createChangedSinceGuard();
    const token = guard.begin('list');
    guard.reloaded('list');
    assert.equal(guard.isCurrent('list', token), false);
  });

  it('tracks each list on its own', () => {
    const guard = createChangedSinceGuard();
    const a = guard.begin('a');
    guard.reloaded('b');
    assert.equal(guard.isCurrent('a', a), true);
    guard.reloaded('a', 1_000);
    assert.equal(guard.lastReloadAt('a'), 1_000);
    assert.equal(guard.lastReloadAt('b') > 0, true);
    assert.equal(guard.lastReloadAt('c'), 0);
  });
});
