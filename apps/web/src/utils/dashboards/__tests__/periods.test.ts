import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { periodRange, weekStarts } from '../periods';

const now = new Date('2026-11-24T15:30:00.000Z');

describe('periodRange', () => {
  it('starts at midnight UTC and ends now, the previous range of equal length', () => {
    const r = periodRange('30d', now);
    assert.equal(r.start.toISOString(), '2026-10-25T00:00:00.000Z');
    assert.equal(r.end.toISOString(), now.toISOString());
    assert.equal(
      r.previousStart.getTime(),
      r.start.getTime() - (now.getTime() - r.start.getTime()),
    );
    assert.equal(periodRange('90d', now).start.toISOString(), '2026-08-26T00:00:00.000Z');
    assert.equal(periodRange('6m', now).start.toISOString(), '2026-05-24T00:00:00.000Z');
    assert.equal(periodRange('12m', now).start.toISOString(), '2025-11-24T00:00:00.000Z');
  });

  it('lists the Mondays from the start week to the current week', () => {
    const weeks = weekStarts(periodRange('30d', now));
    assert.equal(weeks[0], '2026-10-19');
    assert.equal(weeks.at(-1), '2026-11-23');
    assert.equal(weeks.length, 6);
  });
});
