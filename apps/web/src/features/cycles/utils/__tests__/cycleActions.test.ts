import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canArchiveCycle, newCycleInput } from '../cycleActions';

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

describe('newCycleInput', () => {
  it('maps the dates to UTC days, the end day included', () => {
    assert.deepEqual(
      newCycleInput({ name: ' Launch ', startsAt: '2026-12-01', endsAt: '2026-12-14' }, 't1'),
      {
        teamId: 't1',
        name: 'Launch',
        startsAt: '2026-12-01T00:00:00.000Z',
        endsAt: '2026-12-15T00:00:00.000Z',
      },
    );
  });

  it('omits a blank name', () => {
    const input = newCycleInput({ name: '  ', startsAt: '2026-12-01', endsAt: '2026-12-01' }, 't1');
    assert.deepEqual(input, {
      teamId: 't1',
      startsAt: '2026-12-01T00:00:00.000Z',
      endsAt: '2026-12-02T00:00:00.000Z',
    });
  });

  it('refuses an end before the start', () => {
    assert.deepEqual(
      newCycleInput({ name: '', startsAt: '2026-12-10', endsAt: '2026-12-01' }, 't1'),
      { error: 'The end date must not be before the start date.' },
    );
  });

  it('refuses a missing date', () => {
    assert.deepEqual(newCycleInput({ name: '', startsAt: '', endsAt: '2026-12-01' }, 't1'), {
      error: 'Choose a start and an end date.',
    });
  });
});
