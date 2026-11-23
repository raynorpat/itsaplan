import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Cycle } from '@/types/team';
import {
  assignableCycles,
  cycleLabel,
  cycleOptions,
  cyclesVisible,
  sortedCycles,
  withoutCycleOptions,
} from '@/utils/cycles';

// Cycle controls appear only for a team with cycles turned on.

describe('cyclesVisible', () => {
  it('is true when the team has cycles on', () => {
    assert.equal(cyclesVisible({ cycles: { enabled: true } }), true);
  });

  it('is false when the team has cycles off', () => {
    assert.equal(cyclesVisible({ cycles: { enabled: false } }), false);
  });

  it('is false while the team is not loaded', () => {
    assert.equal(cyclesVisible(null), false);
    assert.equal(cyclesVisible(undefined), false);
  });
});

// The cycles a team offers: the current one, the upcoming ones, and past ones
// newest first; labels fall back to the number.

const day = (d: number) => new Date(Date.UTC(2026, 10, d)).toISOString();
const cycle = (id: string, n: number, start: number, end: number, extra: Partial<Cycle> = {}) => ({
  id,
  number: n,
  name: null,
  startsAt: day(start),
  endsAt: day(end),
  completedAt: null,
  ...extra,
});
const now = new Date(Date.UTC(2026, 10, 10, 12));
const past = cycle('p', 1, 1, 8, { completedAt: day(8) });
const current = cycle('c', 2, 8, 15);
const next = cycle('n', 3, 15, 22);
const later = cycle('l', 4, 22, 29);

describe('cycleLabel', () => {
  it('uses the name when there is one', () => {
    assert.equal(cycleLabel({ ...current, name: 'Launch' }), 'Launch');
  });

  it('falls back to "Cycle N" when unnamed or blank', () => {
    assert.equal(cycleLabel(current), 'Cycle 2');
    assert.equal(cycleLabel({ ...current, name: '  ' }), 'Cycle 2');
  });
});

describe('cycleOptions', () => {
  it('splits the current cycle from the upcoming ones, sorted, and drops past ones', () => {
    const { current: c, upcoming } = cycleOptions([later, past, next, current], now);
    assert.equal(c?.id, 'c');
    assert.deepEqual(
      upcoming.map((x) => x.id),
      ['n', 'l'],
    );
  });

  it('has no current cycle during a cooldown', () => {
    const { current: c, upcoming } = cycleOptions([past, next], new Date(Date.UTC(2026, 10, 12)));
    assert.equal(c, undefined);
    assert.deepEqual(
      upcoming.map((x) => x.id),
      ['n'],
    );
  });

  it('does not count a completed cycle as current', () => {
    const done = { ...current, completedAt: day(9) };
    assert.equal(cycleOptions([done], now).current, undefined);
  });
});

describe('sortedCycles', () => {
  it('orders current, then upcoming soonest first, then past newest first', () => {
    const older = cycle('o', 0, 1, 2, { completedAt: day(2) });
    assert.deepEqual(
      sortedCycles([older, later, past, next, current], now).map((x) => x.id),
      ['c', 'n', 'l', 'p', 'o'],
    );
  });
});

describe('withoutCycleOptions', () => {
  it('drops the cycle option only when cycles are off', () => {
    const options = [{ value: 'status' }, { value: 'cycle' }];
    assert.deepEqual(withoutCycleOptions(options, true), options);
    assert.deepEqual(withoutCycleOptions(options, false), [{ value: 'status' }]);
  });
});

describe('assignableCycles', () => {
  it('lists the current cycle, then the upcoming ones', () => {
    assert.deepEqual(
      assignableCycles([later, past, next, current], now).map((c) => c.id),
      ['c', 'n', 'l'],
    );
  });
});
