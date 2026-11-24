import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { completedIssuesFilter, mergeInsightIssues, periodStart, withinPeriod } from '../data';
import type { InsightIssue } from '../slices';

const issue = (id: string, title = id) => ({ id, title }) as InsightIssue;

describe('insights data', () => {
  it('starts the period at midnight UTC, the given number of months back', () => {
    const now = new Date('2026-11-24T15:30:00.000Z');
    assert.equal(periodStart(3, now).toISOString(), '2026-08-24T00:00:00.000Z');
    assert.equal(periodStart(12, now).toISOString(), '2025-11-24T00:00:00.000Z');
  });

  it('clamps the day to the end of a shorter month', () => {
    assert.equal(
      periodStart(1, new Date('2026-03-31T10:00:00.000Z')).toISOString(),
      '2026-02-28T00:00:00.000Z',
    );
  });

  it('drops issues closed before the period and keeps open and recent ones', () => {
    const since = new Date('2026-10-01T00:00:00.000Z');
    const kept = withinPeriod(
      [
        { ...issue('open'), completedAt: null, canceledAt: null },
        { ...issue('old'), completedAt: '2026-06-01T00:00:00.000Z', canceledAt: null },
        { ...issue('gone'), completedAt: null, canceledAt: '2026-05-01T00:00:00.000Z' },
        { ...issue('new'), completedAt: '2026-10-05T00:00:00.000Z', canceledAt: null },
      ],
      since,
    );
    assert.deepEqual(
      kept.map((i) => i.id),
      ['open', 'new'],
    );
  });

  it('leaves sub-issues out of the fetch when the view hides them', () => {
    const since = new Date('2026-10-01T00:00:00.000Z');
    const scope = { team: { id: { eq: 't' } } };
    assert.deepEqual(completedIssuesFilter(scope, since, true), {
      and: [scope, { completedAt: { gte: since.toISOString() } }],
    });
    assert.deepEqual(completedIssuesFilter(scope, since, false), {
      and: [scope, { completedAt: { gte: since.toISOString() } }, { parent: { null: true } }],
    });
  });

  it("keeps the view's own issues and adds each fetched issue the view does not have", () => {
    const merged = mergeInsightIssues(
      [issue('a', 'from view'), issue('b')],
      [issue('a', 'fetched'), issue('c')],
    );
    assert.deepEqual(
      merged.map((i) => [i.id, i.title]),
      [
        ['a', 'from view'],
        ['b', 'b'],
        ['c', 'c'],
      ],
    );
  });
});
