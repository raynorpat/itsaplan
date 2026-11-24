import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createDebouncedSaver, switchLayout, toDisplay, toStored } from '../listPreferences';
import { defaultViewSettings, normalizeSavedDisplay } from '../viewSettings';

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

describe('switchLayout', () => {
  it('keeps every setting between List and Board', () => {
    const s = {
      ...defaultViewSettings('list'),
      group: 'priority' as const,
      properties: ['id' as const],
    };
    assert.deepEqual(switchLayout(s, 'list', 'kanban'), s);
  });

  it('starts Timeline and Calendar from their defaults, keeping completed and sub-issue filters', () => {
    const s = {
      ...defaultViewSettings('list'),
      completedIssues: 'week' as const,
      showSubIssues: false,
      group: 'priority' as const,
    };
    const t = switchLayout(s, 'list', 'timeline');
    assert.deepEqual(t, {
      ...defaultViewSettings('timeline'),
      completedIssues: 'week',
      showSubIssues: false,
      weekStart: t.weekStart,
    });
  });

  it('starts List from its defaults when coming from Timeline', () => {
    const fromTimeline = defaultViewSettings('timeline');
    assert.deepEqual(
      switchLayout(fromTimeline, 'timeline', 'list').properties,
      defaultViewSettings('list').properties,
    );
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
