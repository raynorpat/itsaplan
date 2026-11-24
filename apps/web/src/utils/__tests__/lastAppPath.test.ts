import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { backToAppHref, isAppPath } from '@/utils/lastAppPath';

describe('lastAppPath', () => {
  it('remembers pages outside Settings', () => {
    assert.equal(isAppPath('/team/ENG/issue/3'), true);
    assert.equal(isAppPath('/inbox'), true);
    assert.equal(isAppPath('/settings/account/profile'), false);
    assert.equal(isAppPath('/settings'), false);
  });

  it('goes back to the remembered page, else to the start page', () => {
    assert.equal(backToAppHref('/projects?team=ENG'), '/projects?team=ENG');
    assert.equal(backToAppHref(null), '/');
    assert.equal(backToAppHref('/settings/workspace/general'), '/');
    // Only same-origin paths: anything else in storage is ignored.
    assert.equal(backToAppHref('https://example.com/x'), '/');
    assert.equal(backToAppHref('//example.com/x'), '/');
  });
});
