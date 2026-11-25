import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computeWidget } from '../compute';
import { ctx, cycle, issue, NOW, project, request, widget } from './fixtures';

const bars = (r: ReturnType<typeof computeWidget>) => {
  assert.equal(r.kind, 'bars');
  return r.kind === 'bars' ? r.rows.map((x) => [x.label, x.value]) : [];
};
const num = (r: ReturnType<typeof computeWidget>) => {
  assert.equal(r.kind, 'number');
  return r.kind === 'number' ? [r.value, r.previous] : [];
};

describe('issues', () => {
  const issues = [
    issue({ id: '1', stateId: 's-todo', priority: 1, createdAt: '2026-11-20T00:00:00.000Z' }),
    issue({ id: '2', stateId: 's-doing', priority: 1, createdAt: '2026-01-01T00:00:00.000Z' }),
    issue({
      id: '3',
      stateId: 's-done',
      createdAt: '2026-11-02T00:00:00.000Z',
      startedAt: '2026-11-04T00:00:00.000Z',
      completedAt: '2026-11-06T00:00:00.000Z',
    }),
    issue({ id: '4', stateId: 's-done', completedAt: '2026-11-08T00:00:00.000Z' }),
    issue({ id: '5', stateId: 's-done', completedAt: '2026-09-01T00:00:00.000Z' }),
  ];

  it('counts open issues by status whatever the period', () => {
    const w = widget('chart', { data: 'issues', measure: 'open', slice: 'status' });
    assert.deepEqual(bars(computeWidget(w, { issues }, ctx())), [
      ['Todo', 1],
      ['In Progress', 1],
    ]);
  });

  it('counts completed issues inside the period and the previous period', () => {
    const w = widget('number', { data: 'issues', measure: 'completed' });
    assert.deepEqual(num(computeWidget(w, { issues }, ctx())), [2, 0]);
    // 90 days take in the September completion; the 90 days before hold none.
    assert.deepEqual(num(computeWidget(w, { issues }, ctx({ period: '90d' }))), [3, 0]);
  });

  it('reports cycle time over started issues and counts the never-started ones', () => {
    const w = widget('number', { data: 'issues', measure: 'cycleTime' });
    const r = computeWidget(w, { issues }, ctx());
    assert.deepEqual(num(r), [2, null]);
    assert.equal(r.excluded, 1);
  });

  it('keeps only the dashboard team', () => {
    const other = issue({ id: '9', teamId: 't-des', stateId: 's-todo' });
    const w = widget('number', { data: 'issues', measure: 'open' });
    assert.deepEqual(
      num(computeWidget(w, { issues: [...issues, other] }, ctx({ teamId: 't-des' }))),
      [1, null],
    );
  });

  it('gives zero and null, never NaN, for no rows', () => {
    assert.deepEqual(
      num(
        computeWidget(
          widget('number', { data: 'issues', measure: 'created' }),
          { issues: [] },
          ctx(),
        ),
      ),
      [0, 0],
    );
    assert.deepEqual(
      num(
        computeWidget(
          widget('number', { data: 'issues', measure: 'leadTime' }),
          { issues: [] },
          ctx(),
        ),
      ),
      [null, null],
    );
    assert.deepEqual(
      bars(
        computeWidget(
          widget('chart', { data: 'issues', measure: 'open', slice: 'status' }),
          {},
          ctx(),
        ),
      ),
      [],
    );
  });

  it('counts created and completed per week side by side', () => {
    const w = widget('chart', {
      data: 'issues',
      measure: 'created',
      compareMeasure: 'completed',
      chart: 'overTimeBars',
    });
    const r = computeWidget(w, { issues }, ctx());
    assert.equal(r.kind, 'overTime');
    if (r.kind !== 'overTime') return;
    assert.deepEqual(
      r.series.map((s) => s.key),
      ['created', 'completed'],
    );
    const week = r.weeks.find((x) => x.week === '2026-11-02')!;
    assert.deepEqual(week.values, { created: 1, completed: 2 });
    assert.equal(
      r.weeks.reduce((n, x) => n + x.values.created!, 0),
      4,
    );
  });
});

describe('feedback requests', () => {
  const a = issue({ id: 'a', startedAt: '2026-11-20T00:00:00.000Z', stateId: 's-doing' });
  const b = issue({ id: 'b', completedAt: '2026-11-18T00:00:00.000Z', stateId: 's-done' });
  const c = issue({ id: 'c' });
  const rows = [
    // Two requests from one person on one issue: 2 requests, 1 person.
    request('1', a, {
      requesterId: 'jane',
      source: 'portal',
      createdAt: '2026-11-10T00:00:00.000Z',
    }),
    request('2', a, {
      requesterId: 'jane',
      source: 'portal',
      createdAt: '2026-11-12T00:00:00.000Z',
      important: true,
    }),
    // A first request before the period still starts the clock.
    request('3', b, { requesterId: 'sam', source: 'form', createdAt: '2026-10-01T00:00:00.000Z' }),
    request('4', c, { requesterId: 'kim', source: 'team', createdAt: '2026-11-15T00:00:00.000Z' }),
  ];

  it('counts requests and distinct people in the period, by source', () => {
    // The October request falls in the previous 30 days.
    assert.deepEqual(
      num(
        computeWidget(
          widget('number', { data: 'requests', measure: 'requests' }),
          { requests: rows },
          ctx(),
        ),
      ),
      [3, 1],
    );
    assert.deepEqual(
      num(
        computeWidget(
          widget('number', { data: 'requests', measure: 'people' }),
          { requests: rows },
          ctx(),
        ),
      ),
      [2, 1],
    );
    assert.deepEqual(
      bars(
        computeWidget(
          widget('chart', { data: 'requests', measure: 'requests', slice: 'source' }),
          { requests: rows },
          ctx(),
        ),
      ),
      [
        ['Logged by team', 1],
        ['Portal', 2],
      ],
    );
  });

  it('shares important requests as a percentage', () => {
    const r = computeWidget(
      widget('number', { data: 'requests', measure: 'importantShare' }),
      { requests: rows },
      ctx(),
    );
    assert.ok(r.kind === 'number' && Math.abs(r.value! - 100 / 3) < 1e-9);
  });

  it('measures time to start and to done from the first request', () => {
    const start = computeWidget(
      widget('number', { data: 'requests', measure: 'timeToStart' }),
      { requests: rows },
      ctx(),
    );
    assert.deepEqual(num(start), [10, null]);
    const done = computeWidget(
      widget('number', { data: 'requests', measure: 'timeToDone' }),
      { requests: rows },
      ctx(),
    );
    assert.deepEqual(num(done), [48, null]);
    // b was completed without a start: left out of time to start.
    assert.equal(start.excluded, 1);
  });

  it('counts new people by their first request ever', () => {
    const firstFeedback = new Map([
      ['jane', '2026-11-10T00:00:00.000Z'],
      ['kim', '2025-01-01T00:00:00.000Z'],
    ]);
    const r = computeWidget(
      widget('number', { data: 'requests', measure: 'newPeople' }),
      { requests: rows },
      ctx({ firstFeedback }),
    );
    assert.deepEqual(num(r), [1, 0]);
  });

  it('lists requested issues not done, most people first', () => {
    const w = widget('table', {
      data: 'requests',
      measure: 'waiting',
      table: {
        columns: ['identifier', 'people', 'requests', 'waitingDays'],
        limit: 10,
        sort: 'requests:desc',
      },
    });
    const r = computeWidget(w, { requests: rows }, ctx());
    assert.equal(r.kind, 'table');
    if (r.kind !== 'table') return;
    assert.deepEqual(
      r.rows.map((x) => x.cells),
      [
        { identifier: 'ENG-a', people: 1, requests: 2, waitingDays: 14 },
        { identifier: 'ENG-c', people: 1, requests: 1, waitingDays: 9 },
      ],
    );
    assert.equal(r.rows[0]!.href, '/team/ENG/issue/a');
  });

  it('counts delivered issues and the people who asked for them', () => {
    assert.deepEqual(
      num(
        computeWidget(
          widget('number', { data: 'requests', measure: 'delivered' }),
          { requests: rows },
          ctx(),
        ),
      ),
      [1, 0],
    );
    assert.deepEqual(
      num(
        computeWidget(
          widget('number', { data: 'requests', measure: 'deliveredPeople' }),
          { requests: rows },
          ctx(),
        ),
      ),
      [1, 0],
    );
  });

  it('gives null time measures for no rows', () => {
    const r = computeWidget(
      widget('number', { data: 'requests', measure: 'timeToDone' }),
      { requests: [] },
      ctx(),
    );
    assert.deepEqual(num(r), [null, null]);
    assert.equal(r.excluded, 0);
  });
});

describe('projects', () => {
  const projects = [
    project({ id: '1', health: 'onTrack', progress: 0.5 }),
    project({ id: '2', health: 'atRisk', progress: 0.25, targetDate: '2026-12-01' }),
    project({ id: '3', health: null, progress: 1, status: 'completed' }),
  ];

  it('groups projects by health, none last', () => {
    const w = widget('chart', {
      data: 'projects',
      measure: 'projects',
      slice: 'health',
      filter: {},
    });
    assert.deepEqual(bars(computeWidget(w, { projects }, ctx())), [
      ['On track', 1],
      ['At risk', 1],
      ['No update', 1],
    ]);
  });

  it('applies the project filter and target window', () => {
    const w = widget('number', {
      data: 'projects',
      measure: 'avgProgress',
      filter: { status: ['started'] },
    });
    assert.deepEqual(num(computeWidget(w, { projects }, ctx())), [37.5, null]);
    const soon = widget('number', {
      data: 'projects',
      measure: 'projects',
      filter: { targetWithinDays: 30 },
    });
    assert.deepEqual(num(computeWidget(soon, { projects }, ctx())), [1, null]);
  });
});

describe('cycles', () => {
  const cycles = [
    cycle({ id: 'e1', number: 1, endsAt: '2026-11-08T00:00:00.000Z', completedScope: 4 }),
    cycle({ id: 'e2', number: 2, endsAt: '2026-11-22T00:00:00.000Z', completedScope: 6 }),
    cycle({
      id: 'd1',
      teamId: 't-des',
      teamKey: 'DES',
      number: 1,
      unit: 'points',
      endsAt: '2026-11-15T00:00:00.000Z',
      completedScope: 20,
    }),
    cycle({
      id: 'e3',
      number: 3,
      startsAt: '2026-11-22T00:00:00.000Z',
      endsAt: '2026-12-06T00:00:00.000Z',
      completedAt: null,
      progress: 0.3,
    }),
  ];

  it('shows ended cycles one bar each, grouped by team, in their units', () => {
    const w = widget('chart', {
      data: 'cycles',
      measure: 'completedScope',
      slice: 'cycle',
      filter: {},
    });
    assert.deepEqual(bars(computeWidget(w, { cycles }, ctx())), [
      ['DES · Cycle 1', 20],
      ['ENG · Cycle 1', 4],
      ['ENG · Cycle 2', 6],
    ]);
  });

  it('does not add cycles of teams with different units', () => {
    const w = widget('number', { data: 'cycles', measure: 'completedScope', filter: {} });
    const all = computeWidget(w, { cycles }, ctx());
    assert.ok(all.kind === 'number' && all.value === null && all.note);
    const eng = computeWidget(w, { cycles }, ctx({ teamId: 't-eng' }));
    assert.ok(eng.kind === 'number' && eng.value === 10 && eng.unit === 'issues');
  });

  it('reads the current cycle progress', () => {
    const w = widget('number', { data: 'cycles', measure: 'currentProgress', filter: {} });
    assert.deepEqual(num(computeWidget(w, { cycles }, ctx())), [30, null]);
  });

  it('keeps the last six ended cycles per team', () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      cycle({
        id: `c${i}`,
        number: i + 1,
        endsAt: new Date(NOW.getTime() - (i + 1) * 86_400_000).toISOString(),
      }),
    );
    const w = widget('chart', { data: 'cycles', measure: 'scope', slice: 'cycle', filter: {} });
    const r = computeWidget(w, { cycles: many }, ctx());
    assert.ok(r.kind === 'bars' && r.rows.length === 6);
  });
});

describe('capping', () => {
  it('passes the capped flag through', () => {
    const r = computeWidget(
      widget('number', { data: 'issues', measure: 'open' }),
      { issues: [], capped: true },
      ctx(),
    );
    assert.equal(r.capped, true);
  });
});
