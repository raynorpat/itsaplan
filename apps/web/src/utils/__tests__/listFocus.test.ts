import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { clearListFocus, readListFocus, rememberListFocus } from '@/utils/listFocus';

describe('list focus store', () => {
  beforeEach(() => clearListFocus());

  it('keeps the focused row per list, outliving the list component', () => {
    rememberListFocus('team-a', 'issue-1');
    rememberListFocus('team-b', 'issue-9');
    assert.equal(readListFocus('team-a'), 'issue-1');
    assert.equal(readListFocus('team-b'), 'issue-9');
  });

  it('forgets a list when its focus is cleared', () => {
    rememberListFocus('team-a', 'issue-1');
    rememberListFocus('team-a', null);
    assert.equal(readListFocus('team-a'), null);
  });
});
