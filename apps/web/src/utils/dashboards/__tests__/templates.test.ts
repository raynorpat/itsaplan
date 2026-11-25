import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { FilterCondition } from '@/utils/filters';
import { parseWidgets } from '../config';
import { TEMPLATES, bugLabelIds, findTemplate } from '../templates';

const ctx = { bugLabelIds: ['label-bug', 'label-eng-bug'] };

describe('TEMPLATES', () => {
  it('offers the five ready-made dashboards', () => {
    assert.deepEqual(
      TEMPLATES.map((t) => t.key),
      ['feedback', 'delivery', 'projects', 'cycles', 'bugs'],
    );
  });

  it('builds widgets that parse unchanged, with unique ids', () => {
    for (const t of TEMPLATES) {
      const widgets = t.widgets(ctx);
      assert.ok(widgets.length > 0, t.key);
      assert.deepEqual(parseWidgets(widgets), widgets, t.key);
      assert.equal(new Set(widgets.map((w) => w.id)).size, widgets.length, t.key);
    }
  });

  it('builds fresh widget objects on each call', () => {
    const t = findTemplate('feedback')!;
    assert.notEqual(t.widgets(ctx)[0], t.widgets(ctx)[0]);
  });
});

describe('Feedback template', () => {
  const widgets = findTemplate('feedback')!.widgets(ctx);

  it('charts requests per week by source', () => {
    const w = widgets.find(
      (x) => x.config.data === 'requests' && x.config.measure === 'requests' && x.kind === 'chart',
    );
    assert.ok(w);
    assert.equal(w.config.slice, 'source');
    assert.equal(w.config.chart, 'overTimeBars');
  });

  it('lists the 20 most requested issues not done, by people', () => {
    const w = widgets.find((x) => x.kind === 'table' && x.config.measure === 'waiting');
    assert.ok(w);
    assert.equal(w.config.table?.limit, 20);
    assert.equal(w.config.table?.sort, 'people:desc');
  });

  it('lists requested issues not started, oldest first request first', () => {
    const w = widgets.find(
      (x) => x.kind === 'table' && x.config.table?.sort === 'firstRequestAt:asc',
    );
    assert.ok(w);
    const status = (w.config.filter as FilterCondition[]).find((c) => c.field === 'statusType');
    assert.deepEqual(status?.values, ['backlog', 'unstarted']);
  });

  it('splits requests by customer tier and lists the top customers by requests', () => {
    const tier = widgets.find((x) => x.config.slice === 'tier');
    assert.ok(tier);
    assert.equal(tier.config.data, 'requests');
    assert.equal(tier.config.title, 'Requests by customer tier');
    const top = widgets.find((x) => x.config.data === 'customers');
    assert.ok(top);
    assert.equal(top.kind, 'table');
    assert.equal(top.config.title, 'Top customers by requests');
    assert.equal(top.config.table?.sort, 'requests:desc');
    assert.equal(top.config.table?.limit, 10);
  });

  it('shows the median time to start and to done as numbers', () => {
    const numbers = widgets.filter((x) => x.kind === 'number').map((x) => x.config.measure);
    assert.ok(numbers.includes('timeToStart'));
    assert.ok(numbers.includes('timeToDone'));
    assert.ok(numbers.includes('requests'));
    assert.ok(numbers.includes('newPeople'));
    assert.ok(numbers.includes('delivered'));
  });
});

describe('Bugs template', () => {
  it('filters every widget on the given labels', () => {
    const widgets = findTemplate('bugs')!.widgets(ctx);
    for (const w of widgets) {
      const labels = (w.config.filter as FilterCondition[]).find((c) => c.field === 'labels');
      assert.deepEqual(labels?.values, ['label-bug', 'label-eng-bug'], w.config.title);
      assert.equal(labels?.op, 'is');
    }
  });

  it('finds the labels named Bug, whatever the case', () => {
    assert.deepEqual(
      bugLabelIds([
        { id: 'a', name: 'Bug' },
        { id: 'b', name: 'bug ' },
        { id: 'c', name: 'Bugfix' },
        { id: 'd', name: 'Feature' },
      ]),
      ['a', 'b'],
    );
  });

  it('says it needs a label', () => {
    assert.equal(findTemplate('bugs')!.needsBugLabel, true);
    assert.equal(findTemplate('delivery')!.needsBugLabel, false);
  });
});

describe('Cycles and Projects templates', () => {
  it('Cycles widgets use cycles data, split per cycle or team', () => {
    for (const w of findTemplate('cycles')!.widgets(ctx)) {
      assert.equal(w.config.data, 'cycles');
      if (w.kind === 'chart') assert.ok(['cycle', 'team'].includes(w.config.slice ?? ''));
    }
  });

  it('Projects widgets use projects data, with a 30-day target table', () => {
    const widgets = findTemplate('projects')!.widgets(ctx);
    assert.ok(widgets.every((w) => w.config.data === 'projects'));
    assert.ok(
      widgets.some(
        (w) =>
          w.kind === 'table' &&
          (w.config.filter as { targetWithinDays?: number }).targetWithinDays === 30,
      ),
    );
  });
});
