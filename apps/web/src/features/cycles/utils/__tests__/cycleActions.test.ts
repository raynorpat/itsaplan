import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canArchiveCycle } from '../cycleActions';

// The cycles page's create and archive controls.
describe('canArchiveCycle', () => {
  const base = { startsAt: '2026-11-02T00:00:00.000Z', endsAt: '2026-11-16T00:00:00.000Z' };

  it('offers archive for a completed cycle', () => {
    assert.equal(canArchiveCycle({ ...base, completedAt: '2026-11-16T00:00:00.000Z' }), true);
  });

  it('does not offer it for the current or an upcoming cycle', () => {
    assert.equal(canArchiveCycle({ ...base, completedAt: null }), false);
  });

  it('does not offer it for an archived cycle', () => {
    assert.equal(
      canArchiveCycle({
        ...base,
        completedAt: '2026-11-16T00:00:00.000Z',
        archivedAt: '2026-11-20T00:00:00.000Z',
      }),
      false,
    );
  });
});
