import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { visibleIssues } from '../completedIssues';

const now = new Date('2026-11-24T12:00:00Z');
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();

type Row = {
  id: string;
  completedAt: string | null;
  canceledAt: string | null;
  parentId: string | null;
};
const row = (id: string, patch: Partial<Row> = {}): Row => ({
  id,
  completedAt: null,
  canceledAt: null,
  parentId: null,
  ...patch,
});

const issues = [
  row('open'),
  row('done-2d', { completedAt: daysAgo(2) }),
  row('done-20d', { completedAt: daysAgo(20) }),
  row('done-60d', { completedAt: daysAgo(60) }),
  row('canceled-3d', { canceledAt: daysAgo(3) }),
  row('canceled-40d', { canceledAt: daysAgo(40) }),
  row('sub', { parentId: 'open' }),
];
const ids = (list: Row[]) => list.map((i) => i.id);

describe('completed issues window', () => {
  it('keeps every issue with "all"', () => {
    assert.deepEqual(
      ids(visibleIssues(issues, { completedIssues: 'all', showSubIssues: true }, now)),
      ids(issues),
    );
  });

  it('hides every completed and canceled issue with "none"', () => {
    assert.deepEqual(
      ids(visibleIssues(issues, { completedIssues: 'none', showSubIssues: true }, now)),
      ['open', 'sub'],
    );
  });

  it('keeps issues closed in the past week', () => {
    assert.deepEqual(
      ids(visibleIssues(issues, { completedIssues: 'week', showSubIssues: true }, now)),
      ['open', 'done-2d', 'canceled-3d', 'sub'],
    );
  });

  it('keeps issues closed in the past month', () => {
    assert.deepEqual(
      ids(visibleIssues(issues, { completedIssues: 'month', showSubIssues: true }, now)),
      ['open', 'done-2d', 'done-20d', 'canceled-3d', 'sub'],
    );
  });

  it('hides sub-issues when they are turned off', () => {
    assert.deepEqual(
      ids(visibleIssues(issues, { completedIssues: 'none', showSubIssues: false }, now)),
      ['open'],
    );
  });
});
