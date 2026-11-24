import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ISSUE_DEPENDENT_KEYS, qk } from '@/services/queryKeys';

// Each prefix in ISSUE_DEPENDENT_KEYS is invalidated after every issue write.
const covers = (key: readonly unknown[]) =>
  ISSUE_DEPENDENT_KEYS.some((prefix) => prefix.every((part, i) => key[i] === part));

describe('ISSUE_DEPENDENT_KEYS', () => {
  it('refreshes every My issues tab after an issue write', () => {
    for (const tab of ['assigned', 'created', 'subscribed', 'activity'] as const) {
      assert.equal(covers(qk.myIssues(tab, false, 'paged')), true, tab);
      assert.equal(covers(qk.myIssues(tab, true, 'all')), true, tab);
    }
  });

  it('keeps refreshing project and cycle progress', () => {
    assert.equal(covers(qk.anyProject), true);
    assert.equal(covers(qk.anyCycles), true);
  });

  it('refreshes every issue’s parent and sub-issues', () => {
    assert.equal(covers(qk.issueFamily('any-issue')), true);
  });

  it('refreshes every project’s feedback (an issue can move between projects)', () => {
    assert.equal(covers(qk.projectFeedback('any-project')), true);
  });

  it('refreshes request counts (an issue can move between teams or be deleted)', () => {
    assert.equal(covers(qk.teamRequests('ENG')), true);
    assert.equal(covers(qk.insightsRequests('view', '{}')), true);
  });
});
