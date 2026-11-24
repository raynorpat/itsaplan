import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createPreferenceSync, preferencesState } from '../listPreferences';
import { displayToPreferences, preferencesToDisplay } from '../viewPreferences';
import { normalizeSavedDisplay } from '../viewSettings';

describe('list preferences', () => {
  it('opens a list never changed with the defaults: List, grouped by status', () => {
    const d = preferencesToDisplay(null);
    assert.equal(d.layout, 'list');
    assert.equal(d.group, 'status');
    assert.deepEqual(d, normalizeSavedDisplay({ layout: 'list' }));
  });

  it("reads Linear's preference names, mapping the board layout", () => {
    const d = preferencesToDisplay({ layout: 'board', issueGrouping: 'priority' });
    assert.equal(d.layout, 'kanban');
    assert.equal(d.group, 'priority');
  });

  it('ignores unknown keys and keeps defaults for missing ones', () => {
    const d = preferencesToDisplay({ bogus: 1, issueGrouping: 'nonsense' } as never);
    assert.deepEqual(d, preferencesToDisplay(null));
  });

  it('keeps the grouping and ordering of a Timeline display, so List finds them again', () => {
    const d = {
      ...preferencesToDisplay(null),
      layout: 'timeline' as const,
      group: 'priority' as const,
      sort: { field: 'dueDate' as const, dir: 'desc' as const },
    };
    const back = preferencesToDisplay(displayToPreferences(d));
    assert.equal(back.layout, 'timeline');
    assert.equal(back.group, 'priority');
    assert.deepEqual(back.sort, { field: 'dueDate', dir: 'desc' });
  });

  it('keeps collapsed groups and swimlanes through a save and read', () => {
    const d = {
      ...preferencesToDisplay(null),
      collapsedGroups: ['s1', 's1/p2'],
      collapsedSwimlanes: ['a7'],
    };
    const back = preferencesToDisplay(displayToPreferences(d));
    assert.deepEqual(back.collapsedGroups, ['s1', 's1/p2']);
    assert.deepEqual(back.collapsedSwimlanes, ['a7']);
  });

  it('does not store the week start (a browser preference)', () => {
    assert.equal('weekStart' in displayToPreferences(preferencesToDisplay(null)), false);
  });
});

describe('preferencesState', () => {
  it('allows saving only once the stored display has loaded', () => {
    assert.deepEqual(preferencesState({ isSuccess: false, isError: false }), {
      status: 'loading',
      canSave: false,
    });
    assert.deepEqual(preferencesState({ isSuccess: true, isError: false }), {
      status: 'ready',
      canSave: true,
    });
  });

  it('never allows saving after a failed load, so the defaults never replace the record', () => {
    assert.deepEqual(preferencesState({ isSuccess: false, isError: true }), {
      status: 'error',
      canSave: false,
    });
  });
});

describe('createPreferenceSync', () => {
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

  // A save that resolves or rejects when the test says so.
  function controlledSave() {
    const calls: { value: number; keepalive: boolean; done: () => void; fail: () => void }[] = [];
    const save = (value: number, keepalive: boolean) =>
      new Promise<void>((resolve, reject) => {
        calls.push({ value, keepalive, done: resolve, fail: () => reject(new Error('down')) });
      });
    return { calls, save };
  }

  const settle = () => new Promise((r) => setTimeout(r, 0));

  function setup() {
    const t = fakeTimers();
    const s = controlledSave();
    const saved: [number, boolean][] = [];
    const failed: [number, boolean][] = [];
    const sync = createPreferenceSync<number>({
      save: s.save,
      delayMs: 300,
      timers: t.timers,
      onSaved: (v, latest) => saved.push([v, latest]),
      onFailed: (_err, v, newer) => failed.push([v, newer]),
    });
    return { t, s, saved, failed, sync };
  }

  it('sends two quick changes as one save with the latest value', () => {
    const { t, s, sync } = setup();
    sync.push(1);
    sync.push(2);
    t.fire();
    assert.deepEqual(
      s.calls.map((c) => c.value),
      [2],
    );
  });

  it('flush sends the pending value at once and only once', () => {
    const { t, s, sync } = setup();
    sync.push(5);
    sync.flush();
    t.fire();
    sync.flush();
    assert.deepEqual(
      s.calls.map((c) => c.value),
      [5],
    );
  });

  it('keeps one save in flight and sends the newer value after it', async () => {
    const { t, s, saved, sync } = setup();
    sync.push(1);
    t.fire();
    sync.push(2);
    t.fire();
    assert.equal(s.calls.length, 1, 'the second save waits for the first');
    s.calls[0]!.done();
    await settle();
    assert.deepEqual(saved, [[1, false]]);
    assert.deepEqual(
      s.calls.map((c) => c.value),
      [1, 2],
    );
    s.calls[1]!.done();
    await settle();
    assert.deepEqual(saved.at(-1), [2, true]);
  });

  it('reports a failure as superseded when a newer value is still to be sent', async () => {
    const { t, s, failed, sync } = setup();
    sync.push(1);
    t.fire();
    sync.push(2);
    s.calls[0]!.fail();
    await settle();
    assert.deepEqual(failed, [[1, true]]);
    t.fire();
    assert.deepEqual(
      s.calls.map((c) => c.value),
      [1, 2],
    );
  });

  it('flushes with keepalive when the page is hidden', () => {
    const { s, sync } = setup();
    sync.push(3);
    sync.flush(true);
    assert.deepEqual(
      s.calls.map((c) => [c.value, c.keepalive]),
      [[3, true]],
    );
  });

  it('cancel drops a pending value', () => {
    const { t, s, sync } = setup();
    sync.push(4);
    sync.cancel();
    t.fire();
    sync.flush();
    assert.equal(s.calls.length, 0);
  });
});
