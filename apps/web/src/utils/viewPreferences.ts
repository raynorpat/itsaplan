import type {
  GroupField,
  PropertyKey,
  SavedViewDisplay,
  TimelineScale,
} from '@/utils/viewSettings';
import { normalizeSavedDisplay } from '@/utils/viewSettings';
import type { SortField, WorkItemsView } from '@/utils/viewTypes';

// A saved view's display as Linear's view preferences (ViewPreferencesValues). Only
// settings Linear has a preference for are saved with a view; the rest (collapsed
// columns, the timeline's collapse-all, the week start) take their defaults when a
// view is opened.

const LAYOUT: Record<WorkItemsView, string> = {
  kanban: 'board',
  table: 'list',
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
  columnOrderList?: readonly string[] | null;
  timelineZoomScale?: number | null;
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
    columnOrderList: d.properties,
    timelineZoomScale: ZOOM[d.timelineScale],
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
    properties: prefs.columnOrderList ? properties : undefined,
    timelineScale:
      prefs.timelineZoomScale == null ? undefined : invert(ZOOM).get(prefs.timelineZoomScale),
  };
  return normalizeSavedDisplay(blob);
}
