import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parentCandidates, subIssueInput, subIssueProgress } from '../subIssues';

describe('subIssueProgress', () => {
  it('counts completed and canceled children as done', () => {
    const children = ['completed', 'canceled', 'started', 'unstarted', 'backlog'].map((type) => ({
      state: { type },
    }));
    assert.deepEqual(subIssueProgress(children), { done: 2, total: 5 });
  });

  it('is zero of zero without children', () => {
    assert.deepEqual(subIssueProgress([]), { done: 0, total: 0 });
  });
});

describe('subIssueInput', () => {
  const team = { states: [{ id: 's-first' }, { id: 's-second' }] };

  it('trims the title and puts the sub-issue in the team’s first state', () => {
    assert.deepEqual(subIssueInput('  Fix  ', team, 'p1'), {
      title: 'Fix',
      parentId: 'p1',
      stateId: 's-first',
    });
  });

  it('creates nothing for an empty or whitespace title', () => {
    assert.equal(subIssueInput('   ', team, 'p1'), null);
    assert.equal(subIssueInput('', team, 'p1'), null);
  });

  it('creates nothing when the team has no state', () => {
    assert.equal(subIssueInput('Fix', { states: [] }, 'p1'), null);
  });
});

describe('parentCandidates', () => {
  it('leaves out the issue itself and its sub-issues', () => {
    assert.deepEqual(
      parentCandidates([{ id: 'a' }, { id: 'self' }, { id: 'c1' }], 'self', ['c1']),
      [{ id: 'a' }],
    );
  });
});
