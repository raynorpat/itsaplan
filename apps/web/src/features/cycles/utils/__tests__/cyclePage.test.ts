import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Issue } from '@/lib/api';
import { patchIssueInList } from '@/utils/boardCache';
import {
  chartPoints,
  cycleDays,
  cycleIssues,
  cycleProgress,
  liveCycleProgress,
  mergeCyclePages,
} from '../cyclePage';

// The cycles page and a cycle's page: the cycle's issues from the board cache, the
// progress numbers and the chart's points.

const issue = (id: string, cycleId: string | null) => ({ id, cycleId }) as Issue;

describe('cycleIssues', () => {
  it('keeps the issues in the cycle', () => {
    const list = [issue('a', 'c1'), issue('b', 'c2'), issue('c', null)];
    assert.deepEqual(
      cycleIssues(list, 'c1').map((i) => i.id),
      ['a'],
    );
  });

  it('follows an issue moved to another cycle on the board', () => {
    const list = [issue('a', 'c1'), issue('b', 'c1')];
    const moved = patchIssueInList(list, issue('b', 'c2'));
    assert.deepEqual(
      cycleIssues(moved, 'c1').map((i) => i.id),
      ['a'],
    );
    assert.deepEqual(
      cycleIssues(moved, 'c2').map((i) => i.id),
      ['b'],
    );
  });
});

const cycle = (over: Partial<Parameters<typeof chartPoints>[0]> = {}) => ({
  startsAt: '2026-11-02T00:00:00.000Z',
  endsAt: '2026-11-16T00:00:00.000Z',
  progress: 0,
  scopeHistory: [] as number[],
  inProgressScopeHistory: [] as number[],
  completedScopeHistory: [] as number[],
  ...over,
});

describe('chartPoints', () => {
  it('has no points while the cycle has no history', () => {
    assert.deepEqual(chartPoints(cycle()), []);
  });

  it('gives one point per recorded day of a 14-day cycle', () => {
    const points = chartPoints(
      cycle({
        scopeHistory: [4, 5, 5],
        inProgressScopeHistory: [0, 1, 2],
        completedScopeHistory: [0, 0, 1],
      }),
    );
    assert.deepEqual(points, [
      { scope: 4, started: 0, completed: 0 },
      { scope: 5, started: 1, completed: 0 },
      { scope: 5, started: 2, completed: 1 },
    ]);
  });

  it('stops at the cycle length', () => {
    const long = Array.from({ length: 20 }, () => 1);
    const points = chartPoints(
      cycle({ scopeHistory: long, inProgressScopeHistory: long, completedScopeHistory: long }),
    );
    assert.equal(points.length, 14);
  });
});

describe('cycleProgress', () => {
  it('is zero without history', () => {
    assert.deepEqual(cycleProgress(cycle()), { percent: 0, scope: 0, started: 0, completed: 0 });
  });

  it('takes the percent from progress and the numbers from the last recorded day', () => {
    assert.deepEqual(
      cycleProgress(
        cycle({
          progress: 0.4375,
          scopeHistory: [4, 8],
          inProgressScopeHistory: [0, 2],
          completedScopeHistory: [0, 3],
        }),
      ),
      { percent: 43, scope: 8, started: 2, completed: 3 },
    );
  });
});

describe('mergeCyclePages', () => {
  it('drops a cycle a later page repeats and lists by number, newest first', () => {
    const out = mergeCyclePages([
      [
        { id: 'x', number: 9 },
        { id: 'y', number: 7 },
      ],
      [
        { id: 'y', number: 7 },
        { id: 'z', number: 8 },
      ],
    ]);
    assert.deepEqual(
      out.map((c) => c.number),
      [9, 8, 7],
    );
  });
});

describe('cycleDays', () => {
  it('gives the first and last UTC calendar day', () => {
    assert.deepEqual(cycleDays('2026-11-23T00:00:00.000Z', '2026-12-07T00:00:00.000Z'), {
      first: '2026-11-23',
      last: '2026-12-06',
    });
  });
});

describe('liveCycleProgress', () => {
  const states = new Map([
    ['todo', 'unstarted'],
    ['doing', 'started'],
    ['done', 'completed'],
    ['gone', 'canceled'],
  ] as const);
  const at = (id: string, stateId: string, estimate: number | null = null) =>
    ({ id, cycleId: 'c1', stateId, estimate }) as Issue;

  it('weights like the API: completed 1, started 0.25, canceled left out', () => {
    const p = liveCycleProgress(
      [at('a', 'todo'), at('b', 'doing'), at('c', 'done'), at('d', 'done'), at('e', 'gone')],
      states,
    );
    assert.deepEqual(p, { percent: 56, scope: 4, started: 1, completed: 2 });
  });

  it('weights by estimate when any issue has one, 1 for an issue without', () => {
    const p = liveCycleProgress([at('a', 'done', 3), at('b', 'todo')], states);
    assert.deepEqual(p, { percent: 75, scope: 4, started: 0, completed: 3 });
  });

  it('is 0 with no issues, and never 100 while open issues remain', () => {
    assert.deepEqual(liveCycleProgress([], states), {
      percent: 0,
      scope: 0,
      started: 0,
      completed: 0,
    });
    assert.equal(liveCycleProgress([at('a', 'done', 2), at('b', 'todo', 0)], states).percent, 99);
  });
});

describe('cycleProgress percent', () => {
  it('rounds down, so 0.999 is not shown as 100%', () => {
    const c = {
      startsAt: '2026-11-23T00:00:00Z',
      endsAt: '2026-11-30T00:00:00Z',
      progress: 0.999,
      scopeHistory: [],
      inProgressScopeHistory: [],
      completedScopeHistory: [],
    };
    assert.equal(cycleProgress(c).percent, 99);
  });
});
