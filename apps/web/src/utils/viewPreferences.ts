import type {
  GroupField,
  PropertyKey,
  SavedViewDisplay,
  TimelineScale,
} from '@/utils/viewSettings';
import { normalizeSavedDisplay } from '@/utils/viewSettings';
import type { SortField, WorkItemsView } from '@/utils/viewTypes';

// A display (a saved view's, or a list kind's personal one) as Linear's view
// preferences (ViewPreferencesValues). Only settings Linear has a preference for are
// saved; the rest (the timeline's collapse-all, the week start) take their defaults
// when the display is read. Collapsed groups (list sections and board columns) are
// Linear's hiddenGroupsList, collapsed swimlanes its hiddenRows.

const LAYOUT: Record<WorkItemsView, string> = {
  kanban: 'board',
  list: 'list',
  timeline: 'timeline',
  calendar: 'calendar',
};

const GROUPING: Record<GroupField, string> = {
  none: 'noGrouping',
  status: 'workflowState',
  assignee: 'assignee',
  delegate: 'delegate',
  priority: 'priority',
  project: 'project',
  cycle: 'cycle',
};

const ORDERING: Record<SortField, string> = {
  manual: 'manual',
  title: 'title',
  identifier: 'identifier',
  status: 'workflowState',
  priority: 'priority',
  assignee: 'assignee',
  dueDate: 'dueDate',
  created: 'createdAt',
  updated: 'updatedAt',
};

// Linear's field toggle for each property. The delegate has none; it is saved by its
// place in columnOrderList alone.
const FIELD: Partial<Record<PropertyKey, string>> = {
  id: 'fieldId',
  status: 'fieldStatus',
  priority: 'fieldPriority',
  assignee: 'fieldAssignee',
  project: 'fieldProject',
  cycle: 'fieldCycle',
  labels: 'fieldLabels',
  dueDate: 'fieldDueDate',
  created: 'fieldDateCreated',
  updated: 'fieldDateUpdated',
};

// Linear's timelineZoomScale is a number; the timeline's three scales are 1, 2 and 3.
const ZOOM: Record<TimelineScale, number> = { week: 1, month: 2, quarter: 3 };

// The ViewPreferencesValues fields the web reads back; the GraphQL selection in
// views.service.ts asks for exactly these.
export interface ViewPreferenceValues {
  layout?: string | null;
  viewOrdering?: string | null;
  viewOrderingDirection?: string | null;
  issueGrouping?: string | null;
  issueSubGrouping?: string | null;
  showEmptyGroups?: boolean | null;
  hiddenColumns?: readonly string[] | null;
  hiddenGroupsList?: readonly string[] | null;
  hiddenRows?: readonly string[] | null;
  columnOrderList?: readonly string[] | null;
  timelineZoomScale?: number | null;
  showCompletedIssues?: string | null;
  showSubIssues?: boolean | null;
  fieldId?: boolean | null;
  fieldStatus?: boolean | null;
  fieldPriority?: boolean | null;
  fieldAssignee?: boolean | null;
  fieldProject?: boolean | null;
  fieldCycle?: boolean | null;
  fieldLabels?: boolean | null;
  fieldDueDate?: boolean | null;
  fieldDateCreated?: boolean | null;
  fieldDateUpdated?: boolean | null;
}

const invert = <K extends string, V extends string | number>(m: Record<K, V>) =>
  new Map(Object.entries(m).map(([k, v]) => [v as V, k as K]));

export function displayToPreferences(d: SavedViewDisplay): ViewPreferenceValues {
  const prefs: Record<string, unknown> = {
    layout: LAYOUT[d.layout],
    viewOrdering: ORDERING[d.sort.field],
    viewOrderingDirection: d.sort.dir,
    issueGrouping: GROUPING[d.group],
    issueSubGrouping: GROUPING[d.subgroup],
    showEmptyGroups: d.showEmptyGroups,
    hiddenColumns: d.hiddenGroups,
    hiddenGroupsList: d.collapsedGroups,
    hiddenRows: d.collapsedSwimlanes,
    columnOrderList: d.properties,
    timelineZoomScale: ZOOM[d.timelineScale],
    showCompletedIssues: d.completedIssues,
    showSubIssues: d.showSubIssues,
  };
  for (const [property, field] of Object.entries(FIELD))
    prefs[field] = d.properties.includes(property as PropertyKey);
  return prefs as ViewPreferenceValues;
}

export function preferencesToDisplay(p: ViewPreferenceValues | null | undefined): SavedViewDisplay {
  const prefs = p ?? {};
  const from = <K extends string>(m: Record<K, string>, v: string | null | undefined) =>
    v == null ? undefined : invert(m).get(v);
  const properties = (prefs.columnOrderList ?? []).filter((key) => {
    const field = FIELD[key as PropertyKey];
    return field ? prefs[field as keyof ViewPreferenceValues] !== false : true;
  });
  const sortField = from(ORDERING, prefs.viewOrdering);
  const blob = {
    layout: from(LAYOUT, prefs.layout),
    sort: sortField ? { field: sortField, dir: prefs.viewOrderingDirection ?? 'asc' } : undefined,
    group: from(GROUPING, prefs.issueGrouping),
    subgroup: from(GROUPING, prefs.issueSubGrouping),
    showEmptyGroups: prefs.showEmptyGroups ?? undefined,
    hiddenGroups: prefs.hiddenColumns ?? undefined,
    collapsedGroups: prefs.hiddenGroupsList ?? undefined,
    collapsedSwimlanes: prefs.hiddenRows ?? undefined,
    properties: prefs.columnOrderList ? properties : undefined,
    timelineScale:
      prefs.timelineZoomScale == null ? undefined : invert(ZOOM).get(prefs.timelineZoomScale),
    // Linear's other windows (day, currentCycle) are not offered here and read as all.
    completedIssues: prefs.showCompletedIssues ?? undefined,
    showSubIssues: prefs.showSubIssues ?? undefined,
  };
  return normalizeSavedDisplay(blob);
}

type Collapse = Pick<SavedViewDisplay, 'collapsedGroups' | 'collapsedSwimlanes'>;

// A saved view's collapsed groups and swimlanes are personal, as in Linear: each
// viewer's are stored as their own preferences for the view (only these two keys,
// over the view's shared ones).
export function collapsePreferences(d: Collapse): ViewPreferenceValues {
  return { hiddenGroupsList: d.collapsedGroups, hiddenRows: d.collapsedSwimlanes };
}

// The display with the given collapse in place of its own: a saved view is written
// for everyone with its shared collapse, not the editor's personal one.
export function withCollapse<T extends Collapse>(d: T, collapse: Collapse): T {
  return {
    ...d,
    collapsedGroups: collapse.collapsedGroups,
    collapsedSwimlanes: collapse.collapsedSwimlanes,
  };
}

const sameKeys = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((k, i) => k === b[i]);

export function collapseChanged<T extends Collapse>(a: T, b: T): boolean {
  return (
    !sameKeys(a.collapsedGroups, b.collapsedGroups) ||
    !sameKeys(a.collapsedSwimlanes, b.collapsedSwimlanes)
  );
}
