import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  chartDays,
  progressHeader,
  progressPercent,
  progressSeries,
  progressUnit,
} from '../progressChart';

// The project progress chart: one point per day of Linear's history arrays, the
// header figures, and the list's percentage.

const now = new Date('2026-11-24T15:00:00Z');

const history = (scope: number[], started: number[], completed: number[]) => ({
  scopeHistory: scope,
  inProgressScopeHistory: started,
  completedScopeHistory: completed,
});

describe('progressSeries', () => {
  it('aligns the days from the start date to today', () => {
    const series = progressSeries(
      {
        startDate: '2026-11-20',
        createdAt: '2026-11-01T09:00:00Z',
        ...history([1, 2, 3, 3, 4], [0, 1, 1, 2, 1], [0, 0, 1, 1, 2]),
      },
      now,
    );
    assert.deepEqual(
      series.map((p) => p.date),
      ['2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23', '2026-11-24'],
    );
    assert.deepEqual(series[4], { date: '2026-11-24', scope: 4, started: 1, completed: 2 });
  });

  it('starts at the creation date without a start date', () => {
    const series = progressSeries(
      { startDate: null, createdAt: '2026-11-24T08:00:00Z', ...history([3], [1], [0]) },
      now,
    );
    assert.deepEqual(series, [{ date: '2026-11-24', scope: 3, started: 1, completed: 0 }]);
  });

  it('ends today when the start date is still ahead', () => {
    const series = progressSeries(
      {
        startDate: '2026-12-01',
        createdAt: '2026-11-20T08:00:00Z',
        ...history([2, 2], [0, 0], [0, 1]),
      },
      now,
    );
    assert.deepEqual(
      series.map((p) => p.date),
      ['2026-11-23', '2026-11-24'],
    );
  });

  it("keeps a closed project's days from its start", () => {
    const series = progressSeries(
      {
        startDate: '2026-11-01',
        createdAt: '2026-10-01T08:00:00Z',
        ...history([2, 2, 2], [1, 0, 0], [0, 1, 2]),
      },
      now,
    );
    assert.deepEqual(
      series.map((p) => p.date),
      ['2026-11-01', '2026-11-02', '2026-11-03'],
    );
  });

  it('reads a missing value as 0 and an empty history as no points', () => {
    const series = progressSeries(
      { startDate: '2026-11-24', createdAt: '2026-11-24T08:00:00Z', ...history([2], [], []) },
      now,
    );
    assert.deepEqual(series, [{ date: '2026-11-24', scope: 2, started: 0, completed: 0 }]);
    assert.deepEqual(
      progressSeries(
        { startDate: null, createdAt: '2026-11-24T08:00:00Z', ...history([], [], []) },
        now,
      ),
      [],
    );
  });
});

describe('progressUnit', () => {
  it('is issues when the scope histories equal the issue counts', () => {
    assert.equal(
      progressUnit({
        scopeHistory: [2, 3],
        completedScopeHistory: [0, 1],
        issueCountHistory: [2, 3],
        completedIssueCountHistory: [0, 1],
      }),
      'issues',
    );
  });

  it('is points when they differ', () => {
    assert.equal(
      progressUnit({
        scopeHistory: [5, 8],
        completedScopeHistory: [0, 3],
        issueCountHistory: [2, 3],
        completedIssueCountHistory: [0, 1],
      }),
      'points',
    );
  });
});

describe('progressHeader', () => {
  it('shows the scope and the started and completed shares', () => {
    assert.equal(
      progressHeader({ scope: 42, started: 12, completed: 18 }, 'points'),
      'Scope 42 points · Started 12 (29%) · Completed 18 (43%)',
    );
  });

  it('uses the singular for one and 0% for an empty scope', () => {
    assert.equal(
      progressHeader({ scope: 1, started: 0, completed: 1 }, 'issues'),
      'Scope 1 issue · Started 0 (0%) · Completed 1 (100%)',
    );
    assert.equal(
      progressHeader({ scope: 0, started: 0, completed: 0 }, 'issues'),
      'Scope 0 issues · Started 0 (0%) · Completed 0 (0%)',
    );
  });
});

describe('progressPercent', () => {
  it('rounds to a whole percent', () => {
    assert.equal(progressPercent(0), 0);
    assert.equal(progressPercent(0.4286), 43);
    assert.equal(progressPercent(1), 100);
  });

  it('never shows 100% for an unfinished project', () => {
    assert.equal(progressPercent(0.999), 99);
  });
});

describe('chartDays', () => {
  const series = [
    { date: '2026-11-23', scope: 2, started: 0, completed: 0 },
    { date: '2026-11-24', scope: 2, started: 1, completed: 0 },
  ];

  it('adds empty days up to a later target date', () => {
    assert.deepEqual(chartDays(series, '2026-11-26'), [
      ...series,
      { date: '2026-11-25' },
      { date: '2026-11-26' },
    ]);
  });

  it('adds nothing for no target or a target already in the series', () => {
    assert.deepEqual(chartDays(series, null), series);
    assert.deepEqual(chartDays(series, '2026-11-01'), series);
  });
});
