import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mergeInsightIssues, periodStart } from '../data';
import type { InsightIssue } from '../slices';

const issue = (id: string, title = id) => ({ id, title }) as InsightIssue;

describe('insights data', () => {
  it('starts the period at midnight UTC, the given number of months back', () => {
    const now = new Date('2026-11-24T15:30:00.000Z');
    assert.equal(periodStart(3, now).toISOString(), '2026-08-24T00:00:00.000Z');
    assert.equal(periodStart(12, now).toISOString(), '2025-11-24T00:00:00.000Z');
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
