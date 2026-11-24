import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import {
  clearListFocus,
  readListFocus,
  rememberListFocus,
  subscribeListFocus,
} from '@/utils/listFocus';

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

  it('tells a mounted list when another surface (the peek panel) moves its focus', () => {
    const seen: [string, string | null][] = [];
    const stop = subscribeListFocus((list, id) => seen.push([list, id]));
    rememberListFocus('team-a', 'issue-2');
    stop();
    rememberListFocus('team-a', 'issue-3');
    assert.deepEqual(seen, [['team-a', 'issue-2']]);
  });
});
