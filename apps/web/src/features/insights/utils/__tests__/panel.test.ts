import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_INSIGHTS_SETTINGS } from '../settings';
import {
  effectiveSettings,
  formatDays,
  insightsScope,
  measureOptions,
  sliceOptions,
  withSliceFilter,
} from '../panel';

describe('formatDays', () => {
  it('shows days with one decimal under ten, whole days above', () => {
    assert.equal(formatDays(3.46), '3.5 d');
    assert.equal(formatDays(12.4), '12 d');
    assert.equal(formatDays(0), '0 d');
  });
  it('shows hours under a day', () => {
    assert.equal(formatDays(0.25), '6 h');
    assert.equal(formatDays(0.01), '<1 h');
  });
});

describe('measure and slice options', () => {
  it('offers points only when the issues have estimates', () => {
    assert.ok(!measureOptions({ hasEstimates: false, hasRequests: false }).includes('points'));
    assert.ok(measureOptions({ hasEstimates: true, hasRequests: false }).includes('points'));
  });
  it('falls back from a stored customer measure while Customers is off', () => {
    const opts = { hasEstimates: false, hasRequests: true, spansTeams: false };
    const stored = { ...DEFAULT_INSIGHTS_SETTINGS, measure: 'customers' as const };
    assert.equal(effectiveSettings(stored, { ...opts, hasCustomers: false }).measure, 'count');
    assert.equal(effectiveSettings(stored, { ...opts, hasCustomers: true }).measure, 'customers');
  });
  it('offers team only where the view spans teams', () => {
    assert.ok(!sliceOptions({ spansTeams: false }).includes('team'));
    assert.ok(sliceOptions({ spansTeams: true }).includes('team'));
  });
  it('falls back to defaults for options the view does not offer', () => {
    const s = effectiveSettings(
      { ...DEFAULT_INSIGHTS_SETTINGS, measure: 'points', slice: 'team', segment: 'team' },
      { hasEstimates: false, hasRequests: false, spansTeams: false },
    );
    assert.equal(s.measure, 'count');
    assert.equal(s.slice, 'status');
    assert.equal(s.segment, null);
  });
  it('drops a segment equal to the slice', () => {
    const s = effectiveSettings(
      { ...DEFAULT_INSIGHTS_SETTINGS, slice: 'assignee', segment: 'assignee' },
      { hasEstimates: true, hasRequests: false, spansTeams: true },
    );
    assert.equal(s.segment, null);
  });
});

describe('insightsScope', () => {
  it('combines the view scope with its filter', () => {
    assert.deepEqual(
      insightsScope(
        { team: { id: { eq: 't' } } },
        {
          conditions: [{ id: 'a', field: 'priority', op: 'is', values: [1] }],
        },
      ),
      {
        and: [{ team: { id: { eq: 't' } } }, { and: [{ priority: { in: [1] } }] }],
      },
    );
  });
  it('is the scope alone without filter conditions', () => {
    assert.deepEqual(insightsScope({ project: { id: { eq: 'p' } } }, { conditions: [] }), {
      project: { id: { eq: 'p' } },
    });
  });
});

describe('withSliceFilter', () => {
  it('adds the slice condition, replacing an earlier one for the same field', () => {
    const first = withSliceFilter(
      { conditions: [{ id: 'x', field: 'labels', op: 'is', values: ['l'] }] },
      { id: 'insights-priority', field: 'priority', op: 'is', values: [1] },
    );
    const second = withSliceFilter(first, {
      id: 'insights-priority',
      field: 'priority',
      op: 'is',
      values: [2],
    });
    assert.deepEqual(
      second.conditions.map((c) => [c.field, c.values]),
      [
        ['labels', ['l']],
        ['priority', [2]],
      ],
    );
  });
});
