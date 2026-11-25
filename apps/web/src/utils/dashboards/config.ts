import type { FilterCondition } from '@/utils/filters';

// The shape of a dashboard widget as stored by the API (which checks only the outer
// shape) and the measures and slices each kind of data offers.

export type DataKind = 'issues' | 'requests' | 'projects' | 'cycles';
export type WidgetKind = 'chart' | 'number' | 'table';
export type WidgetWidth = 'half' | 'full';
export type DashboardPeriod = '30d' | '90d' | '6m' | '12m';
export type ChartStyle = 'bars' | 'overTimeBars' | 'overTimeLine';
export type ProjectHealth = 'onTrack' | 'atRisk' | 'offTrack';

export const DASHBOARD_PERIODS: DashboardPeriod[] = ['30d', '90d', '6m', '12m'];
export const DEFAULT_PERIOD: DashboardPeriod = '90d';
export const PERIOD_LABELS: Record<DashboardPeriod, string> = {
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
  '6m': 'Last 6 months',
  '12m': 'Last 12 months',
};

export interface ProjectFilter {
  status?: string[];
  leadIds?: string[];
  teamIds?: string[];
  labelIds?: string[];
  health?: (ProjectHealth | 'none')[];
  // Projects whose target date falls between today and this many days ahead.
  targetWithinDays?: number;
}

export interface CycleFilter {
  teamIds?: string[];
}

export interface TableConfig {
  columns: string[];
  // 5 to 50 rows.
  limit: number;
  // "<column>:asc" or "<column>:desc".
  sort: string;
}

export interface WidgetConfig {
  title: string;
  data: DataKind;
  // The issue view filter for issues and requests; an object for projects and cycles.
  filter: FilterCondition[] | ProjectFilter | CycleFilter;
  measure: string;
  // A second measure drawn beside the first on an over-time chart without a slice.
  compareMeasure?: string | null;
  slice: string | null;
  segment: string | null;
  chart?: ChartStyle;
  table?: TableConfig;
}

export interface Widget {
  id: string;
  kind: WidgetKind;
  width: WidgetWidth;
  config: WidgetConfig;
}

// current: the state now, whatever the period; events: what happened in the period.
export type Basis = 'current' | 'events';
// scope: points or issues, the cycles' unit (the cycles' scope rule).
export type Unit = 'count' | 'points' | 'days' | 'percent' | 'scope';

export interface MeasureDef {
  id: string;
  label: string;
  basis: Basis;
  unit: Unit;
}

export const MEASURES: Record<DataKind, MeasureDef[]> = {
  issues: [
    { id: 'open', label: 'Open issues', basis: 'current', unit: 'count' },
    { id: 'openPoints', label: 'Open points', basis: 'current', unit: 'points' },
    { id: 'created', label: 'Issues created', basis: 'events', unit: 'count' },
    { id: 'completed', label: 'Issues completed', basis: 'events', unit: 'count' },
    { id: 'completedPoints', label: 'Points completed', basis: 'events', unit: 'points' },
    { id: 'cycleTime', label: 'Cycle time', basis: 'events', unit: 'days' },
    { id: 'leadTime', label: 'Lead time', basis: 'events', unit: 'days' },
    { id: 'age', label: 'Issue age', basis: 'current', unit: 'days' },
    { id: 'requests', label: 'Requests on open issues', basis: 'current', unit: 'count' },
    { id: 'requesters', label: 'Requesters on open issues', basis: 'current', unit: 'count' },
  ],
  requests: [
    { id: 'requests', label: 'Requests', basis: 'events', unit: 'count' },
    { id: 'people', label: 'People', basis: 'events', unit: 'count' },
    { id: 'newPeople', label: 'New people', basis: 'events', unit: 'count' },
    { id: 'importantShare', label: 'Marked important', basis: 'events', unit: 'percent' },
    { id: 'timeToStart', label: 'Time to start', basis: 'events', unit: 'days' },
    { id: 'timeToDone', label: 'Time to done', basis: 'events', unit: 'days' },
    { id: 'delivered', label: 'Delivered issues', basis: 'events', unit: 'count' },
    { id: 'deliveredPeople', label: 'People delivered to', basis: 'events', unit: 'count' },
    { id: 'waiting', label: 'Waiting since first request', basis: 'current', unit: 'days' },
  ],
  projects: [
    { id: 'projects', label: 'Projects', basis: 'current', unit: 'count' },
    { id: 'avgProgress', label: 'Average progress', basis: 'current', unit: 'percent' },
  ],
  cycles: [
    { id: 'completedScope', label: 'Completed scope', basis: 'events', unit: 'scope' },
    { id: 'scope', label: 'Scope', basis: 'events', unit: 'scope' },
    { id: 'carriedOver', label: 'Carried over', basis: 'events', unit: 'count' },
    { id: 'currentProgress', label: 'Current cycle progress', basis: 'current', unit: 'percent' },
  ],
};

export const SLICES: Record<DataKind, string[]> = {
  issues: ['status', 'assignee', 'priority', 'label', 'project', 'cycle', 'creator', 'team'],
  requests: ['source', 'important', 'status', 'label', 'project', 'team'],
  projects: ['health', 'status', 'lead', 'team'],
  cycles: ['cycle', 'team'],
};

export const SLICE_LABELS: Record<string, string> = {
  status: 'Status',
  assignee: 'Assignee',
  priority: 'Priority',
  label: 'Label',
  project: 'Project',
  cycle: 'Cycle',
  creator: 'Creator',
  team: 'Team',
  source: 'Source',
  important: 'Important',
  health: 'Health',
  lead: 'Lead',
};

export interface ColumnDef {
  id: string;
  label: string;
}

export const TABLE_COLUMNS: Record<DataKind, ColumnDef[]> = {
  issues: [
    { id: 'identifier', label: 'ID' },
    { id: 'title', label: 'Title' },
    { id: 'status', label: 'Status' },
    { id: 'assignee', label: 'Assignee' },
    { id: 'priority', label: 'Priority' },
    { id: 'estimate', label: 'Estimate' },
    { id: 'requests', label: 'Requests' },
    { id: 'people', label: 'People' },
    { id: 'createdAt', label: 'Created' },
    { id: 'completedAt', label: 'Completed' },
    { id: 'ageDays', label: 'Age (days)' },
  ],
  requests: [
    { id: 'identifier', label: 'ID' },
    { id: 'title', label: 'Title' },
    { id: 'status', label: 'Status' },
    { id: 'people', label: 'People' },
    { id: 'requests', label: 'Requests' },
    { id: 'important', label: 'Important' },
    { id: 'firstRequestAt', label: 'First request' },
    { id: 'lastRequestAt', label: 'Last request' },
    { id: 'waitingDays', label: 'Waiting (days)' },
  ],
  projects: [
    { id: 'name', label: 'Project' },
    { id: 'status', label: 'Status' },
    { id: 'health', label: 'Health' },
    { id: 'progress', label: 'Progress (%)' },
    { id: 'targetDate', label: 'Target date' },
    { id: 'lead', label: 'Lead' },
  ],
  cycles: [
    { id: 'team', label: 'Team' },
    { id: 'cycle', label: 'Cycle' },
    { id: 'startsAt', label: 'Starts' },
    { id: 'endsAt', label: 'Ends' },
    { id: 'scope', label: 'Scope' },
    { id: 'completedScope', label: 'Completed' },
    { id: 'carriedOver', label: 'Carried over' },
    { id: 'progress', label: 'Progress (%)' },
  ],
};

const DATA_KINDS: DataKind[] = ['issues', 'requests', 'projects', 'cycles'];
const WIDGET_KINDS: WidgetKind[] = ['chart', 'number', 'table'];
const WIDTHS: WidgetWidth[] = ['half', 'full'];
const CHART_STYLES: ChartStyle[] = ['bars', 'overTimeBars', 'overTimeLine'];

export function measureDef(data: DataKind, id: string): MeasureDef | undefined {
  return MEASURES[data].find((m) => m.id === id);
}

function oneOf<T>(list: readonly T[], value: unknown): value is T {
  return list.includes(value as T);
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function isCondition(v: unknown): boolean {
  return (
    isObject(v) &&
    typeof v.id === 'string' &&
    typeof v.field === 'string' &&
    typeof v.op === 'string' &&
    Array.isArray(v.values)
  );
}

function parseTable(raw: unknown, data: DataKind): TableConfig | null {
  if (!isObject(raw) || !Array.isArray(raw.columns) || typeof raw.sort !== 'string') return null;
  const known = TABLE_COLUMNS[data].map((c) => c.id);
  if (raw.columns.length === 0 || !raw.columns.every((c) => oneOf(known, c))) return null;
  const limit = typeof raw.limit === 'number' && Number.isFinite(raw.limit) ? raw.limit : 10;
  return {
    columns: raw.columns as string[],
    limit: Math.min(50, Math.max(5, Math.round(limit))),
    sort: raw.sort,
  };
}

function parseWidget(raw: unknown): Widget | null {
  if (!isObject(raw) || typeof raw.id !== 'string' || raw.id === '') return null;
  if (!oneOf(WIDGET_KINDS, raw.kind) || !oneOf(WIDTHS, raw.width)) return null;
  const c = raw.config;
  if (!isObject(c) || typeof c.title !== 'string' || !oneOf(DATA_KINDS, c.data)) return null;
  const data = c.data;
  if (typeof c.measure !== 'string' || !measureDef(data, c.measure)) return null;
  const sliceOk = (v: unknown) => v === null || oneOf(SLICES[data], v);
  if (!sliceOk(c.slice) || !sliceOk(c.segment)) return null;
  const issueLike = data === 'issues' || data === 'requests';
  if (issueLike ? !(Array.isArray(c.filter) && c.filter.every(isCondition)) : !isObject(c.filter))
    return null;
  if (c.chart !== undefined && !oneOf(CHART_STYLES, c.chart)) return null;
  if (
    c.compareMeasure !== undefined &&
    c.compareMeasure !== null &&
    !(typeof c.compareMeasure === 'string' && measureDef(data, c.compareMeasure))
  )
    return null;
  let table: TableConfig | undefined;
  if (c.table !== undefined || raw.kind === 'table') {
    const parsed = parseTable(c.table, data);
    if (!parsed) return null;
    table = parsed;
  }
  const config: WidgetConfig = {
    title: c.title,
    data,
    filter: c.filter as WidgetConfig['filter'],
    measure: c.measure,
    slice: c.slice as string | null,
    segment: c.segment as string | null,
  };
  if (c.compareMeasure !== undefined) config.compareMeasure = c.compareMeasure as string | null;
  if (c.chart !== undefined) config.chart = c.chart;
  if (table) config.table = table;
  return { id: raw.id, kind: raw.kind, width: raw.width, config };
}

// The valid widgets of a stored list, in order; anything else (an older or hand-edited
// entry) is dropped so a dashboard never fails to render.
export function parseWidgets(raw: unknown): Widget[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(parseWidget).filter((w): w is Widget => w !== null);
}
