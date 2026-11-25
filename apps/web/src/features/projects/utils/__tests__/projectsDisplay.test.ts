import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { displayFromPreferences, preferencesFromDisplay } from '../projectsDisplay';

describe('projects display preferences', () => {
  it('defaults to the table, no grouping and the month scale', () => {
    assert.deepEqual(displayFromPreferences(null), {
      layout: 'table',
      grouping: 'none',
      zoom: 'month',
    });
  });

  it('reads and writes Linear names', () => {
    const display = { layout: 'timeline', grouping: 'initiative', zoom: 'quarter' } as const;
    const prefs = preferencesFromDisplay(display);
    assert.deepEqual(prefs, {
      projectLayout: 'timeline',
      projectGrouping: 'initiative',
      timelineZoomScale: 3,
    });
    assert.deepEqual(displayFromPreferences(prefs), display);
    assert.equal(preferencesFromDisplay({ ...display, layout: 'table' }).projectLayout, 'list');
  });

  it('falls back for values it does not offer', () => {
    assert.deepEqual(
      displayFromPreferences({
        projectLayout: 'board',
        projectGrouping: 'health',
        timelineZoomScale: 7,
      }),
      { layout: 'table', grouping: 'none', zoom: 'month' },
    );
  });
});
