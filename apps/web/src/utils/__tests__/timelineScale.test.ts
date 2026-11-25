import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { toDateStr } from '@/utils/dates';
import { dragDates, dragDeltaDays, SCALE_DAY_W, timelineScale } from '@/utils/timelineScale';

const d = (s: string) => {
  const [y, m, day] = s.split('-').map(Number);
  return new Date(y!, m! - 1, day!);
};

// Runs `fn` with the process in time zone `tz`, so a daylight saving change happens
// inside the dates tested whatever the machine's zone (CI runs in UTC).
function inTimeZone(tz: string, fn: () => void) {
  const before = process.env.TZ;
  process.env.TZ = tz;
  try {
    fn();
  } finally {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  }
}

describe('timelineScale', () => {
  const today = d('2026-11-25');

  it('pads the content range by 3 days before and 7 after', () => {
    const s = timelineScale({
      from: d('2026-11-10'),
      to: d('2026-11-20'),
      zoom: 'week',
      viewportW: 0,
      labelW: 0,
      today,
    });
    assert.equal(toDateStr(s.rangeStart), '2026-11-07');
    // 11-07 .. 11-27 (11-20 + 7) is 21 days
    assert.equal(s.days.length, 21);
    assert.equal(s.dayWidth, SCALE_DAY_W.week);
    assert.equal(s.trackWidth, 21 * SCALE_DAY_W.week);
  });

  it('defaults to today minus 3 through today plus 35 without content', () => {
    const s = timelineScale({
      from: null,
      to: null,
      zoom: 'month',
      viewportW: 0,
      labelW: 0,
      today,
    });
    assert.equal(toDateStr(s.rangeStart), '2026-11-22');
    assert.equal(toDateStr(s.days[s.days.length - 1]!), '2026-12-30');
    assert.equal(s.todayInRange, true);
    assert.equal(s.todayLeft, 3 * SCALE_DAY_W.month);
  });

  it('extends with trailing days to fill the viewport', () => {
    const s = timelineScale({
      from: d('2026-11-10'),
      to: d('2026-11-10'),
      zoom: 'week',
      viewportW: 256 + 32 * 40,
      labelW: 256,
      today,
    });
    assert.equal(s.days.length, 40);
  });

  it('maps dates to x and back on day boundaries', () => {
    const s = timelineScale({
      from: d('2026-01-01'),
      to: d('2026-12-31'),
      zoom: 'quarter',
      viewportW: 0,
      labelW: 0,
      today,
    });
    for (const day of ['2026-01-31', '2026-02-28', '2026-03-29', '2026-10-25', '2026-12-31']) {
      assert.equal(toDateStr(s.dateOf(s.xOf(d(day)))), day);
      // Anywhere inside the day's column maps to that day.
      assert.equal(toDateStr(s.dateOf(s.xOf(d(day)) + s.dayWidth - 1)), day);
    }
  });

  it('places a span as a rect covering both end days', () => {
    const s = timelineScale({
      from: d('2026-11-10'),
      to: d('2026-11-20'),
      zoom: 'week',
      viewportW: 0,
      labelW: 0,
      today,
    });
    assert.deepEqual(s.spanToRect(d('2026-11-10'), d('2026-11-12')), {
      left: 3 * 32,
      width: 3 * 32,
    });
  });

  it('labels each month run', () => {
    const s = timelineScale({
      from: d('2026-01-29'),
      to: d('2026-02-02'),
      zoom: 'week',
      viewportW: 0,
      labelW: 0,
      today: d('2026-01-30'),
    });
    assert.deepEqual(
      s.months.map((m) => m.label),
      ['January 2026', 'February 2026'],
    );
    assert.equal(s.months[0]!.width + s.months[1]!.width, s.trackWidth);
  });
});

describe('dragDates', () => {
  it('moves both dates by the same number of days across a month end', () => {
    const r = dragDates({
      mode: 'move',
      start: d('2026-01-30'),
      end: d('2026-02-02'),
      deltaDays: 3,
    });
    assert.equal(toDateStr(r.start), '2026-02-02');
    assert.equal(toDateStr(r.end), '2026-02-05');
  });

  it('moves across a daylight saving change by whole days', () => {
    // The United States falls back on 1 November 2026 (a 25-hour day).
    inTimeZone('America/New_York', () => {
      const r = dragDates({
        mode: 'move',
        start: d('2026-10-31'),
        end: d('2026-11-03'),
        deltaDays: 2,
      });
      assert.equal(toDateStr(r.start), '2026-11-02');
      assert.equal(toDateStr(r.end), '2026-11-05');
    });
  });

  it('resizes the end, never before the start', () => {
    assert.equal(
      toDateStr(
        dragDates({ mode: 'end', start: d('2026-11-10'), end: d('2026-11-12'), deltaDays: 4 }).end,
      ),
      '2026-11-16',
    );
    const r = dragDates({
      mode: 'end',
      start: d('2026-11-10'),
      end: d('2026-11-12'),
      deltaDays: -9,
    });
    assert.equal(toDateStr(r.end), '2026-11-10');
    assert.equal(toDateStr(r.start), '2026-11-10');
  });

  it('resizes the start, never after the end', () => {
    assert.equal(
      toDateStr(
        dragDates({ mode: 'start', start: d('2026-11-10'), end: d('2026-11-12'), deltaDays: -2 })
          .start,
      ),
      '2026-11-08',
    );
    const r = dragDates({
      mode: 'start',
      start: d('2026-11-10'),
      end: d('2026-11-12'),
      deltaDays: 9,
    });
    assert.equal(toDateStr(r.start), '2026-11-12');
    assert.equal(toDateStr(r.end), '2026-11-12');
  });
});

describe('dragDeltaDays', () => {
  it('rounds a pointer distance to whole days', () => {
    assert.equal(dragDeltaDays(0, 32), 0);
    assert.equal(dragDeltaDays(15, 32), 0);
    assert.equal(dragDeltaDays(17, 32), 1);
    assert.equal(dragDeltaDays(-49, 32), -2);
  });
});
