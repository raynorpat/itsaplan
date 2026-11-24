import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  collapseChanged,
  collapsePreferences,
  displayToPreferences,
  preferencesToDisplay,
  withCollapse,
} from '../viewPreferences';
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
  completedIssues: 'week',
  showSubIssues: false,
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
      hiddenGroupsList: [],
      hiddenRows: [],
      columnOrderList: ['labels', 'delegate', 'id'],
      timelineZoomScale: 3,
      showCompletedIssues: 'week',
      showSubIssues: false,
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

describe('view preferences: completed issues and sub-issues', () => {
  it("saves Linear's showCompletedIssues and showSubIssues", () => {
    const prefs = displayToPreferences(display);
    assert.equal(prefs.showCompletedIssues, 'week');
    assert.equal(prefs.showSubIssues, false);
  });

  it('reads them back', () => {
    const back = preferencesToDisplay({
      layout: 'list',
      showCompletedIssues: 'month',
      showSubIssues: false,
    });
    assert.equal(back.completedIssues, 'month');
    assert.equal(back.showSubIssues, false);
  });

  it('reads an unknown completed-issues value as "all" and a missing sub-issue toggle as on', () => {
    const back = preferencesToDisplay({ layout: 'list', showCompletedIssues: 'currentCycle' });
    assert.equal(back.completedIssues, 'all');
    assert.equal(back.showSubIssues, true);
  });
});

describe('personal collapse on a saved view', () => {
  const base = normalizeSavedDisplay({ layout: 'list' });

  it("stores only the viewer's collapsed groups and swimlanes", () => {
    assert.deepEqual(
      collapsePreferences({ ...base, collapsedGroups: ['s1'], collapsedSwimlanes: ['a2'] }),
      { hiddenGroupsList: ['s1'], hiddenRows: ['a2'] },
    );
  });

  it("puts the view's shared collapse back before the view is saved for everyone", () => {
    const mine = { ...base, collapsedGroups: ['mine'], collapsedSwimlanes: ['row'] };
    const out = withCollapse(mine, { collapsedGroups: ['shared'], collapsedSwimlanes: [] });
    assert.deepEqual(out.collapsedGroups, ['shared']);
    assert.deepEqual(out.collapsedSwimlanes, []);
    assert.equal(out.layout, mine.layout);
  });

  it('tells a collapse change from any other display change', () => {
    assert.equal(collapseChanged(base, { ...base, collapsedGroups: ['s1'] }), true);
    assert.equal(collapseChanged(base, { ...base, collapsedSwimlanes: ['a'] }), true);
    assert.equal(collapseChanged(base, { ...base, group: 'priority' }), false);
  });
});
