import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Issue } from '@/lib/api';
import { patchIssueInList } from '@/utils/boardCache';
import { chartPoints, cycleIssues, cycleProgress, mergeCyclePages } from '../cyclePage';

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
      { day: '2026-11-02', scope: 4, started: 0, completed: 0 },
      { day: '2026-11-03', scope: 5, started: 1, completed: 0 },
      { day: '2026-11-04', scope: 5, started: 2, completed: 1 },
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
      { percent: 44, scope: 8, started: 2, completed: 3 },
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
