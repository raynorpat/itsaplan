import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  optimisticVote,
  roadmapColumns,
  statusLabel,
  voteLabel,
  type PortalIssue,
} from '../portal';

const issue = (over: Partial<PortalIssue> = {}): PortalIssue => ({
  identifier: 'ENG-1',
  title: 'Dark mode',
  status: 'planned',
  votes: 3,
  comments: 0,
  voted: false,
  underReview: false,
  ...over,
});

describe('statusLabel', () => {
  it('names each public status', () => {
    assert.equal(statusLabel('planned'), 'Planned');
    assert.equal(statusLabel('inProgress'), 'In progress');
    assert.equal(statusLabel('done'), 'Done');
  });
});

describe('voteLabel', () => {
  it('reads one vote and several votes', () => {
    assert.equal(voteLabel(0), '0 votes');
    assert.equal(voteLabel(1), '1 vote');
    assert.equal(voteLabel(12), '12 votes');
  });
});

describe('roadmapColumns', () => {
  it('groups by status in order and leaves out suggestions under review', () => {
    const a = issue({ identifier: 'A', status: 'planned' });
    const b = issue({ identifier: 'B', status: 'inProgress' });
    const c = issue({ identifier: 'C', status: 'done' });
    const d = issue({ identifier: 'D', status: 'planned' });
    const e = issue({ identifier: 'E', status: 'planned', underReview: true });
    const cols = roadmapColumns([a, b, c, d, e]);
    assert.deepEqual(
      cols.planned.map((i) => i.identifier),
      ['A', 'D'],
    );
    assert.deepEqual(
      cols.inProgress.map((i) => i.identifier),
      ['B'],
    );
    assert.deepEqual(
      cols.done.map((i) => i.identifier),
      ['C'],
    );
  });
  it('gives empty columns for no issues', () => {
    assert.deepEqual(roadmapColumns([]), { planned: [], inProgress: [], done: [] });
  });
});

describe('optimisticVote', () => {
  it('adds a vote', () => {
    assert.deepEqual(optimisticVote(issue(), true), issue({ voted: true, votes: 4 }));
  });
  it('removes a vote, never below zero', () => {
    assert.deepEqual(
      optimisticVote(issue({ voted: true, votes: 4 }), false),
      issue({ voted: false, votes: 3 }),
    );
    assert.equal(optimisticVote(issue({ voted: true, votes: 0 }), false).votes, 0);
  });
  it('leaves the issue unchanged when the vote state already matches', () => {
    const voted = issue({ voted: true, votes: 4 });
    assert.equal(optimisticVote(voted, true), voted);
  });
});
