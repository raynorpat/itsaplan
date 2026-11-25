import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { measureOptions } from '../panel';
import {
  DEFAULT_INSIGHTS_SETTINGS,
  insightsStorageKey,
  insightsViewKey,
  parseInsightsSettings,
  settingsForKey,
} from '../settings';

describe('request measure options', () => {
  it('offers the request measures only when the issues carry requests', () => {
    assert.ok(!measureOptions({ hasEstimates: false, hasRequests: false }).includes('requests'));
    const withRequests = measureOptions({ hasEstimates: false, hasRequests: true });
    assert.ok(withRequests.includes('requests') && withRequests.includes('requesters'));
  });
});

describe('settings', () => {
  it('uses the defaults for nothing stored and for garbage', () => {
    assert.deepEqual(DEFAULT_INSIGHTS_SETTINGS, {
      open: false,
      measure: 'count',
      slice: 'status',
      segment: null,
      periodMonths: 3,
      tab: 'breakdown',
    });
    assert.deepEqual(parseInsightsSettings(null), DEFAULT_INSIGHTS_SETTINGS);
    assert.deepEqual(parseInsightsSettings('{not json'), DEFAULT_INSIGHTS_SETTINGS);
    assert.deepEqual(
      parseInsightsSettings(
        JSON.stringify({
          open: true,
          measure: 'bogus',
          slice: 'label',
          segment: 'x',
          periodMonths: 7,
        }),
      ),
      { ...DEFAULT_INSIGHTS_SETTINGS, open: true, slice: 'label' },
    );
    assert.deepEqual(
      parseInsightsSettings(
        JSON.stringify({
          measure: 'cycleTime',
          segment: 'priority',
          periodMonths: 12,
          tab: 'overTime',
        }),
      ),
      {
        ...DEFAULT_INSIGHTS_SETTINGS,
        measure: 'cycleTime',
        segment: 'priority',
        periodMonths: 12,
        tab: 'overTime',
      },
    );
  });

  it('keys each view', () => {
    assert.equal(insightsViewKey({ kind: 'allIssues', teamId: 't1' }), 'allIssues:t1');
    assert.equal(insightsViewKey({ kind: 'project', projectId: 'p1' }), 'project:p1');
    assert.equal(insightsViewKey({ kind: 'cycle', cycleId: 'c1' }), 'cycle:c1');
    assert.equal(insightsViewKey({ kind: 'myIssues' }), 'myIssues');
    assert.equal(insightsViewKey({ kind: 'view', viewId: 'v1' }), 'view:v1');
    assert.equal(insightsViewKey({ kind: 'newView', teamId: 't1' }), 'newView:t1');
  });

  it("stores each user's settings apart", () => {
    assert.notEqual(insightsStorageKey('u1', 'myIssues'), insightsStorageKey('u2', 'myIssues'));
  });

  it("never applies one view's settings to another view", () => {
    const shown = { key: 'view:a', settings: { ...DEFAULT_INSIGHTS_SETTINGS, open: true } };
    // A change made while the state still holds view a is applied to view b's own.
    assert.deepEqual(
      settingsForKey(shown, 'view:b', () => DEFAULT_INSIGHTS_SETTINGS),
      DEFAULT_INSIGHTS_SETTINGS,
    );
    assert.deepEqual(
      settingsForKey(shown, 'view:a', () => DEFAULT_INSIGHTS_SETTINGS),
      shown.settings,
    );
  });
});
