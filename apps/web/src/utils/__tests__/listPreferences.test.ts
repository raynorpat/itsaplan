import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createDebouncedSaver, toDisplay, toStored } from '../listPreferences';
import { normalizeSavedDisplay } from '../viewSettings';

describe('list preferences', () => {
  it('opens a list never changed with the defaults: List, grouped by status', () => {
    const d = toDisplay(null);
    assert.equal(d.layout, 'list');
    assert.equal(d.group, 'status');
    assert.deepEqual(d, normalizeSavedDisplay({ layout: 'list' }));
  });

  it("reads Linear's preference names, mapping the board layout", () => {
    const d = toDisplay({ layout: 'board', issueGrouping: 'priority' });
    assert.equal(d.layout, 'kanban');
    assert.equal(d.group, 'priority');
  });

  it('ignores unknown keys and keeps defaults for missing ones', () => {
    const d = toDisplay({ bogus: 1, issueGrouping: 'nonsense' } as never);
    assert.deepEqual(d, toDisplay(null));
  });

  it('keeps the grouping and ordering of a Timeline display, so List finds them again', () => {
    const d = {
      ...toDisplay(null),
      layout: 'timeline' as const,
      group: 'priority' as const,
      sort: { field: 'dueDate' as const, dir: 'desc' as const },
    };
    const back = toDisplay(toStored(d));
    assert.equal(back.layout, 'timeline');
    assert.equal(back.group, 'priority');
    assert.deepEqual(back.sort, { field: 'dueDate', dir: 'desc' });
  });

  it('keeps collapsed groups and swimlanes through a save and read', () => {
    const d = {
      ...toDisplay(null),
      collapsedGroups: ['s1', 's1/p2'],
      collapsedSwimlanes: ['a7'],
    };
    const back = toDisplay(toStored(d));
    assert.deepEqual(back.collapsedGroups, ['s1', 's1/p2']);
    assert.deepEqual(back.collapsedSwimlanes, ['a7']);
  });

  it('does not store the week start (a browser preference)', () => {
    assert.equal('weekStart' in toStored(toDisplay(null)), false);
  });
});

describe('createDebouncedSaver', () => {
  function fakeTimers() {
    let pending: (() => void) | null = null;
    return {
      timers: {
        set: (fn: () => void) => {
          pending = fn;
          return 1;
        },
        clear: () => {
          pending = null;
        },
      },
      fire: () => {
        const fn = pending;
        pending = null;
        fn?.();
      },
    };
  }

  it('sends two quick changes as one save with the latest value', () => {
    const saved: number[] = [];
    const t = fakeTimers();
    const saver = createDebouncedSaver<number>((v) => saved.push(v), 300, t.timers);
    saver.push(1);
    saver.push(2);
    t.fire();
    assert.deepEqual(saved, [2]);
  });

  it('flush sends the pending value at once and only once', () => {
    const saved: number[] = [];
    const t = fakeTimers();
    const saver = createDebouncedSaver<number>((v) => saved.push(v), 300, t.timers);
    saver.push(5);
    saver.flush();
    t.fire();
    saver.flush();
    assert.deepEqual(saved, [5]);
  });

  it('flush with nothing pending sends nothing', () => {
    const saved: number[] = [];
    const saver = createDebouncedSaver<number>((v) => saved.push(v), 300, fakeTimers().timers);
    saver.flush();
    assert.deepEqual(saved, []);
  });
});
