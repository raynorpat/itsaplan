import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EMPTY_CONTEXT } from '@/utils/insights/context';
import { widgetInsightsContext } from '../context';

describe('widgetInsightsContext', () => {
  it('groups statuses by name when the dashboard spans all teams', () => {
    assert.equal(widgetInsightsContext(EMPTY_CONTEXT, null).groupStatesByName, true);
  });

  it('keeps one team’s states apart when a team is picked', () => {
    assert.equal(widgetInsightsContext(EMPTY_CONTEXT, 'team-1').groupStatesByName, false);
  });
});
