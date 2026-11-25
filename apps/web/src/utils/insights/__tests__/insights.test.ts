import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { InsightIssue, InsightsContext } from '../slices';
import { breakdown, measureValue } from '../measures';
import { sliceIssues, sliceFilter } from '../slices';
import { timeRows, timeStats } from '../stats';
import { weeklyCreatedCompleted } from '../overTime';
import type { Measure } from '../measures';
import type { SliceField } from '../slices';

const ctx: InsightsContext = {
  states: new Map([
    ['s-todo', { name: 'Todo', type: 'unstarted', position: 1 }],
    ['s-doing', { name: 'In Progress', type: 'started', position: 2 }],
    ['s-done', { name: 'Done', type: 'completed', position: 3 }],
  ]),
  users: new Map([
    ['u-pat', 'Pat'],
    ['u-sam', 'Sam'],
  ]),
  labels: new Map([
    ['l-bug', 'Bug'],
    ['l-ui', 'UI'],
  ]),
  cycles: new Map([['c-1', 'Cycle 1']]),
  teams: new Map([['t-eng', 'Engineering']]),
};

function issue(over: Partial<InsightIssue> & { id: string }): InsightIssue {
  return {
    teamId: 't-eng',
    identifier: `ENG-${over.id}`,
    title: `Issue ${over.id}`,
    stateId: 's-todo',
    assigneeUserId: null,
    creatorUserId: 'u-pat',
    priority: 0,
    estimate: null,
    labelIds: [],
    project: null,
    cycleId: null,
    startedAt: null,
    completedAt: null,
    canceledAt: null,
    createdAt: '2026-11-01T00:00:00.000Z',
    ...over,
  };
}

// The panel's default measure and slices.
const BASE: { measure: Measure; slice: SliceField; segment: SliceField | null } = {
  measure: 'count',
  slice: 'status',
  segment: null,
};

const DAY = 86_400_000;
const at = (iso: string) => new Date(iso).getTime();

describe('slices', () => {
  it('puts an issue with several labels in each label slice, and unlabelled ones in "No label"', () => {
    const slices = sliceIssues(
      [
        issue({ id: '1', labelIds: ['l-bug', 'l-ui'] }),
        issue({ id: '2', labelIds: ['l-bug'] }),
        issue({ id: '3' }),
      ],
      'label',
      ctx,
    );
    const byLabel = Object.fromEntries(slices.map((s) => [s.label, s.issues.map((i) => i.id)]));
    assert.deepEqual(byLabel, { Bug: ['1', '2'], UI: ['1'], 'No label': ['3'] });
    assert.equal(slices.at(-1)?.label, 'No label');
  });

  it('orders status slices by the workflow position and names the empty ones', () => {
    const slices = sliceIssues(
      [issue({ id: '1', stateId: 's-done' }), issue({ id: '2', stateId: 's-todo' })],
      'status',
      ctx,
    );
    assert.deepEqual(
      slices.map((s) => s.label),
      ['Todo', 'Done'],
    );
    const assignee = sliceIssues([issue({ id: '1' })], 'assignee', ctx);
    assert.deepEqual(
      assignee.map((s) => s.label),
      ['Unassigned'],
    );
    assert.deepEqual(
      sliceIssues([issue({ id: '1' })], 'project', ctx).map((s) => s.label),
      ['No project'],
    );
    assert.deepEqual(
      sliceIssues([issue({ id: '1' })], 'cycle', ctx).map((s) => s.label),
      ['No cycle'],
    );
  });

  it('builds a filter condition for each field that the view filter supports', () => {
    assert.deepEqual(sliceFilter('status', 's-todo'), {
      id: 'insights-status',
      field: 'status',
      op: 'is',
      values: ['s-todo'],
    });
    assert.deepEqual(sliceFilter('assignee', 'none')?.values, [null]);
    assert.deepEqual(sliceFilter('assignee', 'u-pat')?.values, ['u-pat']);
    assert.deepEqual(sliceFilter('priority', '1')?.values, [1]);
    assert.deepEqual(sliceFilter('priority', '0')?.values, [null]);
    assert.equal(sliceFilter('label', 'l-bug')?.field, 'labels');
    assert.deepEqual(sliceFilter('label', 'none')?.values, [null]);
    assert.deepEqual(sliceFilter('cycle', 'c-1')?.values, ['c-1']);
    assert.equal(sliceFilter('project', 'p-1'), null);
    assert.equal(sliceFilter('creator', 'u-pat'), null);
    assert.equal(sliceFilter('team', 't-eng'), null);
  });
});

describe('breakdown', () => {
  it('returns nothing for no issues', () => {
    assert.deepEqual(breakdown([], BASE, ctx), []);
  });

  it('counts issues per slice with shares and segments', () => {
    const rows = breakdown(
      [
        issue({ id: '1', assigneeUserId: 'u-pat', priority: 1 }),
        issue({ id: '2', assigneeUserId: 'u-pat', priority: 2 }),
        issue({ id: '3', assigneeUserId: 'u-pat', priority: 1 }),
        issue({ id: '4' }),
      ],
      { ...BASE, slice: 'assignee', segment: 'priority' },
      ctx,
    );
    assert.deepEqual(
      rows.map((r) => [r.label, r.value, r.share]),
      [
        ['Pat', 3, 0.75],
        ['Unassigned', 1, 0.25],
      ],
    );
    assert.deepEqual(
      rows[0]!.segments.map((s) => [s.label, s.value]),
      [
        ['Urgent', 2],
        ['High', 1],
        ['No priority', 0],
      ],
    );
  });

  it('gives every row the segments in their natural order, with zeros', () => {
    const rows = breakdown(
      [
        issue({ id: '1', assigneeUserId: 'u-pat', priority: 4 }),
        issue({ id: '2', assigneeUserId: 'u-sam', priority: 1 }),
        issue({ id: '3', assigneeUserId: 'u-sam', priority: 4 }),
      ],
      { ...BASE, slice: 'assignee', segment: 'priority' },
      ctx,
    );
    for (const r of rows)
      assert.deepEqual(
        r.segments.map((s) => s.label),
        ['Urgent', 'Low'],
      );
    assert.deepEqual(
      rows[0]!.segments.map((s) => s.value),
      [0, 1],
    );
  });

  it('groups statuses of several teams by name when the context asks for it', () => {
    const multi: InsightsContext = {
      ...ctx,
      states: new Map([
        ['a-todo', { name: 'Todo', type: 'unstarted', position: 1 }],
        ['b-todo', { name: 'Todo', type: 'unstarted', position: 1 }],
        ['a-done', { name: 'Done', type: 'completed', position: 3 }],
      ]),
      groupStatesByName: true,
    };
    const slices = sliceIssues(
      [
        issue({ id: '1', stateId: 'a-todo' }),
        issue({ id: '2', stateId: 'b-todo' }),
        issue({ id: '3', stateId: 'a-done' }),
      ],
      'status',
      multi,
    );
    assert.deepEqual(
      slices.map((s) => [s.label, s.issues.length]),
      [
        ['Todo', 2],
        ['Done', 1],
      ],
    );
  });

  it('sums estimate points, an unestimated issue counting 1 as in project progress', () => {
    const rows = breakdown(
      [
        issue({ id: '1', estimate: 3, stateId: 's-todo' }),
        issue({ id: '2', estimate: 5, stateId: 's-todo' }),
        issue({ id: '3', stateId: 's-done' }),
      ],
      { ...BASE, measure: 'points' },
      ctx,
    );
    assert.deepEqual(
      rows.map((r) => [r.label, r.value]),
      [
        ['Todo', 8],
        ['Done', 1],
      ],
    );
  });
});

describe('request measures', () => {
  const req = (ids: string[], important: string[] = [], count = ids.length) => ({
    count,
    requesterIds: [...new Set(ids)],
    importantRequesterIds: important,
  });

  it('counts feedback items and distinct people per slice', () => {
    const issues = [
      // Two feedback items from one person: 2 requests, 1 requester.
      issue({ id: '1', stateId: 's-todo', requests: req(['jane', 'jane'], [], 2) }),
      issue({ id: '2', stateId: 's-todo', requests: req(['jane', 'sam']) }),
      issue({ id: '3', stateId: 's-done' }),
    ];
    const requests = breakdown(issues, { ...BASE, measure: 'requests' }, ctx);
    assert.deepEqual(
      requests.map((r) => [r.label, r.value]),
      [
        ['Todo', 4],
        ['Done', 0],
      ],
    );
    const people = breakdown(issues, { ...BASE, measure: 'requesters' }, ctx);
    assert.deepEqual(
      people.map((r) => [r.label, r.value]),
      [
        ['Todo', 2],
        ['Done', 0],
      ],
    );
    assert.equal(measureValue(issues[0]!, 'requests', new Date()), 2);
    assert.equal(measureValue(issues[0]!, 'requesters', new Date()), 1);
  });
});

describe('time measures', () => {
  const now = new Date('2026-11-24T00:00:00.000Z');

  it('measures cycle time, lead time and age in days', () => {
    const done = issue({
      id: '1',
      createdAt: '2026-11-01T00:00:00.000Z',
      startedAt: '2026-11-03T00:00:00.000Z',
      completedAt: '2026-11-08T12:00:00.000Z',
    });
    assert.equal(measureValue(done, 'cycleTime', now), 5.5);
    assert.equal(measureValue(done, 'leadTime', now), 7.5);
    assert.equal(measureValue(done, 'age', now), null);
    const open = issue({ id: '2', createdAt: '2026-11-14T00:00:00.000Z' });
    assert.equal(measureValue(open, 'age', now), 10);
    assert.equal(measureValue(open, 'leadTime', now), null);
    const canceled = issue({ id: '3', canceledAt: '2026-11-20T00:00:00.000Z' });
    assert.equal(measureValue(canceled, 'age', now), null);
  });

  it('gives no statistics for no values, and percentiles for 1, 2 and 5 values', () => {
    assert.equal(timeStats([]), null);
    assert.deepEqual(timeStats([4]), { median: 4, p25: 4, p75: 4, count: 1 });
    assert.deepEqual(timeStats([3, 1]), { median: 2, p25: 1.5, p75: 2.5, count: 2 });
    assert.deepEqual(timeStats([5, 1, 4, 2, 3]), { median: 3, p25: 2, p75: 4, count: 5 });
  });

  it('leaves completed issues without a start out of cycle time and counts them', () => {
    const result = timeRows(
      [
        issue({
          id: '1',
          assigneeUserId: 'u-pat',
          startedAt: '2026-11-02T00:00:00.000Z',
          completedAt: '2026-11-04T00:00:00.000Z',
        }),
        issue({ id: '2', assigneeUserId: 'u-pat', completedAt: '2026-11-05T00:00:00.000Z' }),
        issue({ id: '3', assigneeUserId: 'u-sam' }),
      ],
      'cycleTime',
      'assignee',
      ctx,
      now,
    );
    assert.equal(result.excluded, 1);
    assert.deepEqual(result.all, { median: 2, p25: 2, p75: 2, count: 1 });
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0]!.label, 'Pat');
    assert.deepEqual(result.rows[0]!.points, [
      {
        issueId: '1',
        identifier: 'ENG-1',
        title: 'Issue 1',
        at: '2026-11-04T00:00:00.000Z',
        days: 2,
      },
    ]);
  });

  it('plots age by creation date for open issues', () => {
    const result = timeRows(
      [issue({ id: '1', createdAt: '2026-11-20T00:00:00.000Z' })],
      'age',
      'status',
      ctx,
      now,
    );
    assert.equal(result.excluded, 0);
    assert.equal(result.rows[0]!.points[0]!.at, '2026-11-20T00:00:00.000Z');
    assert.equal(result.rows[0]!.points[0]!.days, 4);
  });
});

describe('over time', () => {
  it('counts created and completed issues per week, zero for weeks with neither', () => {
    const now = new Date('2026-11-24T12:00:00.000Z'); // a Tuesday
    const weeks = weeklyCreatedCompleted(
      [
        issue({ id: '1', createdAt: '2026-11-23T09:00:00.000Z' }),
        issue({
          id: '2',
          createdAt: '2026-11-02T09:00:00.000Z',
          completedAt: '2026-11-24T09:00:00.000Z',
        }),
        issue({ id: '3', createdAt: '2025-01-01T00:00:00.000Z' }),
      ],
      1,
      now,
    );
    // Weeks start on Monday (UTC); a 1-month period from Oct 24 (a Saturday) starts in the week of Monday Oct 19.
    assert.equal(weeks[0]!.weekStart, '2026-10-19');
    assert.equal(weeks.at(-1)!.weekStart, '2026-11-23');
    assert.equal(weeks.length, 6);
    const byWeek = Object.fromEntries(weeks.map((w) => [w.weekStart, [w.created, w.completed]]));
    assert.deepEqual(byWeek['2026-11-23'], [1, 1]);
    assert.deepEqual(byWeek['2026-11-02'], [1, 0]);
    assert.deepEqual(byWeek['2026-11-09'], [0, 0]);
  });

  it('starts a one-month period on the last day of a shorter month', () => {
    const weeks = weeklyCreatedCompleted([], 1, new Date('2026-03-31T12:00:00.000Z'));
    // Feb 28 2026 is a Saturday: its week starts on Monday Feb 23.
    assert.equal(weeks[0]!.weekStart, '2026-02-23');
  });
});

// Keeps the day arithmetic above honest.
assert.equal((at('2026-11-08T12:00:00.000Z') - at('2026-11-03T00:00:00.000Z')) / DAY, 5.5);
