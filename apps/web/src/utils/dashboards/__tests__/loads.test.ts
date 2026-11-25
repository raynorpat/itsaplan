import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { FilterCondition } from '@/utils/filters';
import { DASHBOARD_ROW_LIMIT, loadKeyFor, loadSpecFor, pagedLoad, scopeFilter } from '../loads';
import { NOW, widget } from './fixtures';

const board = { period: '30d' as const, teamId: null };
const cond = (
  field: string,
  op: FilterCondition['op'],
  values: FilterCondition['values'],
): FilterCondition => ({
  id: `${field}-${op}`,
  field,
  op,
  values,
});

describe('loadKeyFor', () => {
  it('is the same for widgets that need the same rows', () => {
    const a = widget('chart', { data: 'issues', measure: 'created', slice: 'status' });
    const b = widget('number', { data: 'issues', measure: 'completed', slice: null });
    assert.equal(loadKeyFor(a, board, NOW), loadKeyFor(b, board, NOW));
    const openA = widget('chart', { data: 'issues', measure: 'open', slice: 'priority' });
    const openB = widget('table', {
      data: 'issues',
      measure: 'age',
      table: { columns: ['title'], limit: 10, sort: 'title:asc' },
    });
    assert.equal(loadKeyFor(openA, board, NOW), loadKeyFor(openB, board, NOW));
  });

  it('stays the same through the day', () => {
    const w = widget('chart', { data: 'issues', measure: 'created' });
    const later = new Date(NOW.getTime() + 3 * 3_600_000);
    assert.equal(loadKeyFor(w, board, NOW), loadKeyFor(w, board, later));
  });

  it('differs with the filter, team, period or basis', () => {
    const base = widget('chart', { data: 'issues', measure: 'created' });
    const key = loadKeyFor(base, board, NOW);
    const filtered = widget('chart', {
      data: 'issues',
      measure: 'created',
      filter: [cond('priority', 'is', [1])],
    });
    assert.notEqual(loadKeyFor(filtered, board, NOW), key);
    assert.notEqual(loadKeyFor(base, { period: '30d', teamId: 't-eng' }, NOW), key);
    assert.notEqual(loadKeyFor(base, { period: '90d', teamId: null }, NOW), key);
    const current = widget('chart', { data: 'issues', measure: 'open' });
    assert.notEqual(loadKeyFor(current, board, NOW), key);
  });

  it('asks for request counts only when an issue widget shows them', () => {
    const counted = widget('chart', { data: 'issues', measure: 'requests', slice: 'project' });
    const spec = loadSpecFor(counted, board, NOW);
    assert.ok(spec.data === 'issues' && spec.requests === true);
    const plain = loadSpecFor(widget('chart', { data: 'issues', measure: 'open' }), board, NOW);
    assert.ok(plain.data === 'issues' && plain.requests === false);
    const table = widget('table', {
      data: 'issues',
      measure: 'open',
      table: { columns: ['title', 'people'], limit: 10, sort: 'title:asc' },
    });
    const tableSpec = loadSpecFor(table, board, NOW);
    assert.ok(tableSpec.data === 'issues' && tableSpec.requests === true);
    assert.notEqual(
      loadKeyFor(counted, board, NOW),
      loadKeyFor(
        widget('chart', { data: 'issues', measure: 'open', slice: 'project' }),
        board,
        NOW,
      ),
    );
  });

  it('shares one load per data kind for projects', () => {
    const a = widget('chart', { data: 'projects', measure: 'projects', slice: 'health' });
    const b = widget('number', { data: 'projects', measure: 'avgProgress', filter: {} });
    assert.equal(loadKeyFor(a, board, NOW), loadKeyFor(b, { period: '12m', teamId: null }, NOW));
  });
});

describe('scopeFilter', () => {
  it('combines the widget team filter and the dashboard team', () => {
    const f = scopeFilter([cond('team', 'is', ['t-eng', 't-des'])], 't-eng');
    assert.deepEqual(f, {
      and: [{ team: { id: { in: ['t-eng', 't-des'] } } }, { team: { id: { eq: 't-eng' } } }],
    });
  });

  it('keeps the other conditions as the view filter writes them', () => {
    const f = scopeFilter([cond('priority', 'is', [1]), cond('team', 'is_not', ['t-des'])], null);
    assert.deepEqual(f, {
      and: [{ priority: { in: [1] } }, { team: { id: { nin: ['t-des'] } } }],
    });
  });

  it('is null when the widget and dashboard teams conflict', () => {
    assert.equal(scopeFilter([cond('team', 'is', ['t-des'])], 't-eng'), null);
    assert.equal(scopeFilter([cond('team', 'is_not', ['t-eng'])], 't-eng'), null);
  });
});

describe('loadSpecFor', () => {
  it('asks for nothing when the teams conflict', () => {
    const w = widget('chart', {
      data: 'requests',
      measure: 'requests',
      filter: [cond('team', 'is', ['t-des'])],
    });
    assert.equal(loadSpecFor(w, { period: '30d', teamId: 't-eng' }, NOW).data, 'none');
    const cycles = widget('chart', {
      data: 'cycles',
      measure: 'completedScope',
      filter: { teamIds: ['t-des'] },
    });
    assert.equal(loadSpecFor(cycles, { period: '30d', teamId: 't-eng' }, NOW).data, 'none');
  });

  it('loads open issues for current measures and recent ones for events', () => {
    const open = loadSpecFor(widget('chart', { data: 'issues', measure: 'open' }), board, NOW);
    assert.deepEqual(open, {
      data: 'issues',
      filter: { state: { type: { nin: ['completed', 'canceled'] } } },
      requests: false,
    });
    const events = loadSpecFor(widget('chart', { data: 'issues', measure: 'created' }), board, NOW);
    // 30 days back from midnight, then the previous 30 days for the comparison.
    assert.deepEqual(events, {
      data: 'issues',
      filter: {
        or: [
          { createdAt: { gte: '2026-09-24T00:00:00.000Z' } },
          { completedAt: { gte: '2026-09-24T00:00:00.000Z' } },
        ],
      },
      requests: false,
    });
  });

  it('loads every active request of the matching issues whatever the period', () => {
    const w = widget('chart', {
      data: 'requests',
      measure: 'timeToStart',
      filter: [cond('priority', 'is', [1])],
    });
    assert.deepEqual(loadSpecFor(w, { period: '30d', teamId: 't-eng' }, NOW), {
      data: 'requests',
      filter: { issue: { and: [{ priority: { in: [1] } }, { team: { id: { eq: 't-eng' } } }] } },
    });
  });
});

describe('pagedLoad', () => {
  it('stops at the row limit and says it was cut', async () => {
    let asked = 0;
    const result = await pagedLoad(async (_after, first) => {
      asked += first;
      return {
        nodes: Array.from({ length: first }, (_, i) => i),
        pageInfo: { hasNextPage: true, endCursor: String(asked) },
      };
    });
    assert.equal(result.nodes.length, DASHBOARD_ROW_LIMIT);
    assert.equal(DASHBOARD_ROW_LIMIT, 5000);
    assert.equal(result.capped, true);
  });
});
