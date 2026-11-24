import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ISSUE_DEPENDENT_KEYS, qk } from '@/services/queryKeys';

// Each prefix in ISSUE_DEPENDENT_KEYS is invalidated after every issue write.
const covers = (key: readonly unknown[]) =>
  ISSUE_DEPENDENT_KEYS.some((prefix) => prefix.every((part, i) => key[i] === part));

describe('ISSUE_DEPENDENT_KEYS', () => {
  it('refreshes every My issues tab after an issue write', () => {
    for (const tab of ['assigned', 'created', 'subscribed', 'activity'] as const) {
      assert.equal(covers(qk.myIssues(tab, false)), true, tab);
      assert.equal(covers(qk.myIssues(tab, true)), true, tab);
    }
  });

  it('keeps refreshing project and cycle progress', () => {
    assert.equal(covers(qk.anyProject), true);
    assert.equal(covers(qk.anyCycles), true);
  });
});
