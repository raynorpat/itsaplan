import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseWidgets, type Widget } from '@/utils/dashboards/config';
import { dashboardFilterKey, moveWidget, newWidget, rowsOf, withData, withKind } from '../layout';

const w = (id: string, width: Widget['width']): Widget => ({
  id,
  kind: 'number',
  width,
  config: { title: id, data: 'issues', filter: [], measure: 'open', slice: null, segment: null },
});

describe('moveWidget', () => {
  it('moves a widget to a new position', () => {
    const list = [w('a', 'half'), w('b', 'half'), w('c', 'full')];
    assert.deepEqual(
      moveWidget(list, 0, 2).map((x) => x.id),
      ['b', 'c', 'a'],
    );
    assert.deepEqual(
      moveWidget(list, 2, 0).map((x) => x.id),
      ['c', 'a', 'b'],
    );
  });

  it('returns the list unchanged for an out-of-range move', () => {
    const list = [w('a', 'half'), w('b', 'half')];
    assert.deepEqual(moveWidget(list, 0, 5), list);
    assert.deepEqual(moveWidget(list, -1, 0), list);
  });
});

describe('rowsOf', () => {
  it('packs half widgets two per row and puts full widgets alone', () => {
    const rows = rowsOf([
      w('a', 'half'),
      w('b', 'half'),
      w('c', 'half'),
      w('d', 'full'),
      w('e', 'half'),
    ]);
    assert.deepEqual(
      rows.map((r) => r.map((x) => x.id)),
      [['a', 'b'], ['c'], ['d'], ['e']],
    );
  });

  it('gives no rows for no widgets', () => {
    assert.deepEqual(rowsOf([]), []);
  });
});

describe('newWidget', () => {
  it('gives a valid widget for every data kind with a fresh id', () => {
    for (const data of ['issues', 'requests', 'projects', 'cycles'] as const) {
      const a = newWidget(data);
      const b = newWidget(data);
      assert.notEqual(a.id, b.id);
      assert.equal(a.config.data, data);
      assert.deepEqual(parseWidgets([a]), [a], `${data} widget parses`);
    }
  });

  it('starts issues and requests with an empty view filter, others with an object', () => {
    assert.deepEqual(newWidget('issues').config.filter, []);
    assert.deepEqual(newWidget('requests').config.filter, []);
    assert.deepEqual(newWidget('projects').config.filter, {});
    assert.deepEqual(newWidget('cycles').config.filter, {});
  });
});

describe('dashboardFilterKey', () => {
  it('keys the period and team per dashboard', () => {
    assert.equal(dashboardFilterKey('abc'), 'dashboard-filters:abc');
    assert.notEqual(dashboardFilterKey('a'), dashboardFilterKey('b'));
  });
});

describe('withKind', () => {
  it('adds a table setup when a widget becomes a table, and keeps it valid', () => {
    for (const data of ['issues', 'requests', 'projects', 'cycles'] as const) {
      const table = withKind(newWidget(data), 'table');
      assert.equal(table.kind, 'table');
      assert.ok(table.config.table && table.config.table.columns.length > 0);
      assert.deepEqual(parseWidgets([table]), [table], `${data} table parses`);
    }
  });

  it('drops the table setup when a table becomes a chart or a number', () => {
    const table = withKind(newWidget('issues'), 'table');
    assert.equal(withKind(table, 'number').config.table, undefined);
    assert.equal(withKind(table, 'chart').config.table, undefined);
  });
});

describe('withData', () => {
  it('switches the data kind with that kind’s defaults, keeping kind, width and title', () => {
    const w = { ...withKind(newWidget('issues'), 'number'), width: 'full' as const };
    const next = withData({ ...w, config: { ...w.config, title: 'Mine' } }, 'projects');
    assert.equal(next.config.data, 'projects');
    assert.equal(next.kind, 'number');
    assert.equal(next.width, 'full');
    assert.equal(next.config.title, 'Mine');
    assert.deepEqual(parseWidgets([next]), [next]);
  });
});
