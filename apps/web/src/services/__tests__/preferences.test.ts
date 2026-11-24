import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PREFERENCE_DEFAULTS } from '@/services/preferences.service';

describe('PREFERENCE_DEFAULTS', () => {
  it('opens a clicked issue as a full page, as Linear does', () => {
    assert.equal(PREFERENCE_DEFAULTS.issueOpenMode, 'page');
  });
});
