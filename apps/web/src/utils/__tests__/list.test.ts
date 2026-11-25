import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Issue } from '@/types/issue';
import { positionAt, type IssueGroup } from '../team';
import { buildListItems, listDropPatch, listRowProperties, rangeIds, toggledKeys } from '../list';
import { displayToPreferences, preferencesToDisplay } from '../viewPreferences';
import {
  DISPLAY_PROPERTIES,
  defaultViewSettings,
  normalizeSavedDisplay,
  normalizeViewSettings,
} from '../viewSettings';
import { toLayout } from '../viewTypes';

const issue = (id: string, position: number, stateId = 's1') =>
  ({ id, position, stateId, labelIds: [] }) as unknown as Issue;

describe('the table layout folds into the list', () => {
  it('reads the former layout names as today’s', () => {
    assert.equal(toLayout('table'), 'list');
    assert.equal(toLayout('board'), 'kanban');
    assert.equal(toLayout('list'), 'list');
    assert.equal(toLayout('nope'), null);
  });

  it('opens a saved Table view as a list with the same fields, grouping and order', () => {
    const d = normalizeSavedDisplay({
      layout: 'table',
      properties: ['labels', 'priority', 'id'],
      group: 'assignee',
      sort: { field: 'created', dir: 'desc' },
    });
    assert.equal(d.layout, 'list');
    assert.deepEqual(d.properties, ['labels', 'priority', 'id']);
    assert.equal(d.group, 'assignee');
    assert.deepEqual(d.sort, { field: 'created', dir: 'desc' });
  });

  it('round-trips the list layout through Linear’s view preferences', () => {
    const d = normalizeSavedDisplay({ layout: 'list' });
    const prefs = displayToPreferences(d);
    assert.equal(prefs.layout, 'list');
    assert.equal(preferencesToDisplay(prefs).layout, 'list');
  });

  it('defaults to the list with priority, ID and status on the row', () => {
    const d = defaultViewSettings('list');
    for (const p of ['priority', 'id', 'status'] as const) assert.ok(d.properties.includes(p));
    assert.equal(normalizeSavedDisplay({}).layout, 'list');
    assert.equal(normalizeViewSettings(undefined, 'list').group, 'status');
  });
});

describe('listRowProperties', () => {
  it('splits the leading icons from the right-hand fields in Linear’s order', () => {
    const r = listRowProperties(
      ['created', 'assignee', 'labels', 'priority', 'id', 'status', 'cycle', 'dueDate'],
      true,
    );
    assert.deepEqual(r.leading, { priority: true, id: true, status: true });
    assert.deepEqual(r.trailing, ['labels', 'cycle', 'dueDate', 'assignee', 'created']);
  });

  it('places the estimate before the due date', () => {
    const r = listRowProperties(['dueDate', 'estimate', 'labels'], true);
    assert.deepEqual(r.trailing, ['labels', 'estimate', 'dueDate']);
  });

  it('shows the estimate by default on lists and boards, after priority in the menu', () => {
    assert.ok(defaultViewSettings('list').properties.includes('estimate'));
    assert.ok(defaultViewSettings('kanban').properties.includes('estimate'));
    const order = DISPLAY_PROPERTIES.map((p) => p.value);
    assert.equal(order.indexOf('estimate'), order.indexOf('priority') + 1);
  });

  it('drops the cycle while the team’s cycles are off', () => {
    const r = listRowProperties(['cycle', 'project'], false);
    assert.deepEqual(r.trailing, ['project']);
    assert.deepEqual(r.leading, { priority: false, id: false, status: false });
  });
});

describe('buildListItems', () => {
  const groups: IssueGroup[] = [
    { key: 'cs1', name: 'Todo', assign: { stateId: 's1' } },
    { key: 'cs2', name: 'Done', assign: { stateId: 's2' } },
  ];
  const sorted = [issue('a', 1, 's1'), issue('b', 2, 's2'), issue('c', 3, 's2')];
  const settings = { ...defaultViewSettings('list'), group: 'status' as const };

  it('keeps a collapsed group’s header and hides its rows', () => {
    const items = buildListItems({
      groups,
      subGroups: [],
      sorted,
      settings,
      collapsed: new Set(['cs2']),
    });
    assert.deepEqual(
      items.map((it) => (it.kind === 'row' ? it.issue.id : `${it.kind}:${it.count}`)),
      ['header:1', 'a', 'header:2'],
    );
  });
});

describe('listDropPatch', () => {
  const bucket = [issue('a', 1000), issue('b', 2000)];

  it('moves an issue into another group at the drop position', () => {
    assert.deepEqual(listDropPatch({ stateId: 's2' }, bucket, 1), {
      stateId: 's2',
      position: positionAt(bucket, 1),
    });
  });

  it('only reorders inside an ungrouped list', () => {
    assert.deepEqual(listDropPatch(null, bucket, 0), { position: positionAt(bucket, 0) });
  });
});

describe('rangeIds', () => {
  const order = ['a', 'b', 'c', 'd'];

  it('selects every row between the anchor and the clicked row', () => {
    assert.deepEqual(rangeIds(order, 'b', 'd'), ['b', 'c', 'd']);
    assert.deepEqual(rangeIds(order, 'd', 'b'), ['b', 'c', 'd']);
  });

  it('selects only the clicked row without an anchor on the list', () => {
    assert.deepEqual(rangeIds(order, null, 'c'), ['c']);
    assert.deepEqual(rangeIds(order, 'gone', 'c'), ['c']);
  });
});

describe('toggledKeys', () => {
  it('adds a key that is not there and removes one that is', () => {
    assert.deepEqual(toggledKeys(['a'], 'b'), ['a', 'b']);
    assert.deepEqual(toggledKeys(['a', 'b'], 'a'), ['b']);
  });
});
