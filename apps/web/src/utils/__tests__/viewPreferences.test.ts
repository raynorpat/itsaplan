import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { displayToPreferences, preferencesToDisplay } from '../viewPreferences';
import { normalizeSavedDisplay, type SavedViewDisplay } from '../viewSettings';

const display: SavedViewDisplay = {
  ...normalizeSavedDisplay({ layout: 'table' }),
  sort: { field: 'created', dir: 'desc' },
  group: 'assignee',
  subgroup: 'priority',
  showEmptyGroups: false,
  properties: ['labels', 'delegate', 'id'],
  timelineScale: 'quarter',
  hiddenGroups: ['a1'],
};

describe('view preferences', () => {
  it("saves a display as Linear's view preferences", () => {
    assert.deepEqual(displayToPreferences(display), {
      layout: 'list',
      viewOrdering: 'createdAt',
      viewOrderingDirection: 'desc',
      issueGrouping: 'assignee',
      issueSubGrouping: 'priority',
      showEmptyGroups: false,
      hiddenColumns: ['a1'],
      columnOrderList: ['labels', 'delegate', 'id'],
      timelineZoomScale: 3,
      fieldId: true,
      fieldStatus: false,
      fieldPriority: false,
      fieldAssignee: false,
      fieldProject: false,
      fieldCycle: false,
      fieldLabels: true,
      fieldDueDate: false,
      fieldDateCreated: false,
      fieldDateUpdated: false,
    });
  });

  it('reads back the saved display', () => {
    assert.deepEqual(preferencesToDisplay(displayToPreferences(display)), display);
  });

  it('drops a property whose Linear field is off', () => {
    const read = preferencesToDisplay({
      layout: 'board',
      columnOrderList: ['id', 'labels'],
      fieldLabels: false,
    });
    assert.deepEqual(read.properties, ['id']);
    assert.equal(read.layout, 'kanban');
  });

  it('gives defaults for missing preferences', () => {
    assert.deepEqual(preferencesToDisplay(null), normalizeSavedDisplay({}));
  });

  it('saves grouping by cycle and the cycle property', () => {
    const byCycle = { ...display, group: 'cycle' as const, properties: ['cycle' as const] };
    const prefs = displayToPreferences(byCycle);
    assert.equal(prefs.issueGrouping, 'cycle');
    assert.equal(prefs.fieldCycle, true);
    assert.deepEqual(preferencesToDisplay(prefs), byCycle);
  });
});
