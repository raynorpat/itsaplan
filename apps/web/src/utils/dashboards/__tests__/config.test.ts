import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MEASURES, measureDef, parseWidgets, requiresCustomers, SLICES } from '../config';

const good = {
  id: 'w1',
  kind: 'chart',
  width: 'half',
  config: {
    title: 'Requests by source',
    data: 'requests',
    filter: [],
    measure: 'requests',
    slice: 'source',
    segment: null,
    chart: 'overTimeBars',
  },
};

describe('parseWidgets', () => {
  it('keeps valid widgets unchanged', () => {
    assert.deepEqual(parseWidgets([good]), [good]);
  });

  it('drops widgets that are not valid', () => {
    const bad = [
      null,
      'x',
      { ...good, id: '' },
      { ...good, kind: 'pie' },
      { ...good, width: 'third' },
      { ...good, config: { ...good.config, data: 'initiatives' } },
      { ...good, config: { ...good.config, measure: 'points' } },
      { ...good, config: { ...good.config, slice: 'assignee' } },
      { ...good, config: { ...good.config, filter: {} } },
      { ...good, config: { ...good.config, chart: 'pie' } },
      {
        ...good,
        kind: 'table',
        config: { ...good.config, table: { columns: [], limit: 10, sort: 'people:desc' } },
      },
    ];
    assert.deepEqual(parseWidgets([...bad, good]), [good]);
    assert.deepEqual(parseWidgets('nope'), []);
  });

  it('keeps the first of two widgets with the same id', () => {
    const second = { ...good, config: { ...good.config, title: 'Second' } };
    assert.deepEqual(parseWidgets([good, second]), [good]);
  });

  it('clamps a table limit to 5–50', () => {
    const table = {
      ...good,
      kind: 'table',
      config: {
        ...good.config,
        table: { columns: ['title', 'people'], limit: 500, sort: 'people:desc' },
      },
    };
    assert.equal(parseWidgets([table])[0]!.config.table!.limit, 50);
  });

  it('takes an object filter for projects and cycles', () => {
    const project = {
      ...good,
      config: {
        title: 'Health',
        data: 'projects',
        filter: { status: ['started'] },
        measure: 'projects',
        slice: 'health',
        segment: null,
      },
    };
    assert.equal(parseWidgets([project]).length, 1);
  });
});

describe('measures', () => {
  it('gives every measure a basis and unit', () => {
    for (const list of Object.values(MEASURES))
      for (const m of list) {
        assert.ok(m.basis === 'current' || m.basis === 'events', m.id);
        assert.ok(m.label.length > 0);
      }
    assert.equal(measureDef('requests', 'timeToStart')?.unit, 'days');
    assert.equal(measureDef('issues', 'open')?.basis, 'current');
    assert.ok(SLICES.requests.includes('source'));
    assert.ok(SLICES.projects.includes('health'));
  });
});

describe('customers', () => {
  const customers = {
    id: 'c1',
    kind: 'chart',
    width: 'half',
    config: {
      title: 'Customers by tier',
      data: 'customers',
      filter: { tierIds: ['t1'] },
      measure: 'customers',
      slice: 'tier',
      segment: null,
    },
  };

  it('parses a customers widget unchanged', () => {
    assert.deepEqual(parseWidgets([customers]), [customers]);
  });

  it('refuses a customer slice on issues', () => {
    const bad = {
      ...good,
      config: { ...good.config, data: 'issues', measure: 'open', slice: 'tier' },
    };
    assert.deepEqual(parseWidgets([bad]), []);
  });

  it('knows which widgets need Customers', () => {
    const cfg = (over: Record<string, unknown>) =>
      ({ ...good.config, ...over }) as Parameters<typeof requiresCustomers>[0];
    assert.equal(
      requiresCustomers(cfg({ data: 'customers', measure: 'customers', slice: null })),
      true,
    );
    assert.equal(requiresCustomers(cfg({ measure: 'customers', slice: null })), true);
    assert.equal(
      requiresCustomers(cfg({ data: 'issues', measure: 'customerRevenue', slice: null })),
      true,
    );
    assert.equal(requiresCustomers(cfg({ slice: 'tier' })), true);
    assert.equal(requiresCustomers(cfg({ slice: 'source', segment: 'customerStatus' })), true);
    assert.equal(requiresCustomers(cfg({ slice: 'customer' })), true);
    assert.equal(
      requiresCustomers(
        cfg({
          data: 'issues',
          measure: 'open',
          slice: null,
          table: { columns: ['title', 'customers'], limit: 10, sort: 'title:asc' },
        }),
      ),
      true,
    );
    assert.equal(requiresCustomers(cfg({})), false);
  });
});
