import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CyclesPage, firstFeedbackMap, toCycleRow } from '../dashboardData.service';

const node = {
  id: 'c1',
  number: 4,
  name: null,
  startsAt: '2026-11-01T00:00:00.000Z',
  endsAt: '2026-11-15T00:00:00.000Z',
  completedAt: '2026-11-15T00:00:00.000Z',
  scopeHistory: [3, 4],
  completedScopeHistory: [1, 3],
  inProgressScopeHistory: [1, 0],
  issueCountHistory: [3, 5],
  completedIssueCountHistory: [1, 3],
  team: { id: 't-eng', key: 'ENG' },
};

describe('the cycle load', () => {
  it('asks for no per-cycle issue lists or progress', () => {
    const text = JSON.stringify(CyclesPage);
    assert.ok(!text.includes('uncompletedIssuesUponClose'));
    assert.ok(!text.includes('"progress"'));
  });

  it('counts carried-over issues from the histories of a closed cycle', () => {
    const row = toCycleRow(node, new Map());
    assert.equal(row.carriedOver, 2);
    assert.equal(row.unit, 'points');
    assert.equal(row.scope, 4);
    assert.equal(row.completedScope, 3);
    assert.equal(row.progress, 0.75);
  });

  it('takes a running cycle’s progress from the active cycles and carries nothing over', () => {
    const running = { ...node, completedAt: null };
    const row = toCycleRow(running, new Map([['c1', 0.4]]));
    assert.equal(row.carriedOver, 0);
    assert.equal(row.progress, 0.4);
  });
});

describe('first requests', () => {
  it('maps people to their first request', () => {
    const map = firstFeedbackMap([
      { id: 'p1', firstFeedbackAt: '2026-11-10T00:00:00.000Z' },
      { id: 'p2', firstFeedbackAt: new Date('2026-11-11T00:00:00.000Z') },
    ]);
    assert.equal(map.get('p1'), '2026-11-10T00:00:00.000Z');
    assert.equal(map.get('p2'), '2026-11-11T00:00:00.000Z');
  });
});
