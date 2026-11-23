import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { nextWakeUp } from '../notifications';

const n = (snoozedUntil: string | null, extra: Record<string, unknown> = {}) =>
  ({ snoozedUntil, archivedAt: null, readAt: null, ...extra }) as never;

describe('nextWakeUp', () => {
  const now = new Date('2026-11-23T09:00:00Z');
  it('returns the earliest future snooze time', () => {
    const list = [n('2026-11-23T11:00:00Z'), n('2026-11-23T10:00:00Z'), n(null)];
    assert.equal(nextWakeUp(list, now), new Date('2026-11-23T10:00:00Z').getTime());
  });
  it('ignores snoozes already past and archived notifications', () => {
    const list = [
      n('2026-11-23T08:00:00Z'),
      n('2026-11-23T09:30:00Z', { archivedAt: '2026-11-22T00:00:00Z' }),
    ];
    assert.equal(nextWakeUp(list, now), null);
  });
  it('returns null for a list without snoozes', () => {
    assert.equal(nextWakeUp([n(null)], now), null);
  });
});
