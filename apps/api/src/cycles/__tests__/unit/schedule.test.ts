import { describe, expect, it } from 'bun:test';
import { currentCycleStart, cycleEnd, nextCycleStart } from '../../schedule';

// Cycle boundaries on UTC days: a cycle starts at 00:00 UTC on the team's start
// day (0 = Sunday … 6 = Saturday), lasts `duration` weeks, and the next one starts
// `cooldown` weeks after it ends, on the next start day.

const settings = { duration: 2, startDay: 1, cooldown: 0, upcoming: 2 };

describe('cycle schedule', () => {
  it('starts the current cycle on the most recent start day at 00:00 UTC', () => {
    // Wednesday 2026-11-18 15:30 UTC → Monday 2026-11-16.
    expect(currentCycleStart(settings, new Date('2026-11-18T15:30:00Z')).toISOString()).toBe(
      '2026-11-16T00:00:00.000Z',
    );
    // On the start day itself, that day.
    expect(currentCycleStart(settings, new Date('2026-11-16T00:00:00Z')).toISOString()).toBe(
      '2026-11-16T00:00:00.000Z',
    );
  });

  it('ends a cycle after its duration in weeks', () => {
    expect(cycleEnd(new Date('2026-11-16T00:00:00Z'), settings).toISOString()).toBe(
      '2026-11-30T00:00:00.000Z',
    );
  });

  it('starts the next cycle after the cooldown, on the next start day', () => {
    expect(nextCycleStart(new Date('2026-11-30T00:00:00Z'), settings).toISOString()).toBe(
      '2026-11-30T00:00:00.000Z',
    );
    expect(
      nextCycleStart(new Date('2026-11-30T00:00:00Z'), { ...settings, cooldown: 1 }).toISOString(),
    ).toBe('2026-12-07T00:00:00.000Z');
    // An end that is not on a start day moves to the next start day.
    expect(nextCycleStart(new Date('2026-12-02T10:00:00Z'), settings).toISOString()).toBe(
      '2026-12-07T00:00:00.000Z',
    );
  });
});
