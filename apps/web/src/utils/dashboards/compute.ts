import type { BreakdownRow } from '@/utils/insights/measures';
import type { InsightIssue, InsightsContext } from '@/utils/insights/slices';
import { timeStats } from '@/utils/insights/stats';
import {
  measureDef,
  TABLE_COLUMNS,
  type ColumnDef,
  type DashboardPeriod,
  type DataKind,
  type MeasureDef,
  type Widget,
  type WidgetConfig,
} from './config';
import { cycleAdapter, type CycleRow } from './cycleMeasures';
import { requestAdapter, type RequestRow } from './feedbackMeasures';
import { issueAdapter } from './issueMeasures';
import { periodRange, weekKey, weekStarts } from './periods';
import { projectAdapter, type ProjectRow } from './projectMeasures';

// A widget's figures, worked out in the browser from the rows the viewer may read
// (the Insights approach). Each data kind is an adapter: it picks the items a measure
// counts in a time range, groups rows by a slice, and builds table rows; the
// aggregation, the period rules and the result shapes are shared here.

export interface WidgetRows {
  issues?: InsightIssue[];
  requests?: RequestRow[];
  projects?: ProjectRow[];
  cycles?: CycleRow[];
  // The load stopped at its row limit.
  capped?: boolean;
}

export interface ComputeContext {
  now: Date;
  period: DashboardPeriod;
  teamId: string | null;
  insights: InsightsContext;
  // Each requester's first request ever (People list), for "new people".
  firstFeedback: ReadonlyMap<string, string | null>;
}

// One thing a measure counts: `value` is added, averaged or its median taken; `key`
// is what "distinct" counts; `date` places it on an over-time chart.
export interface Item<R> {
  row: R;
  rowId: string;
  value: number;
  key?: string | null;
  date?: string | null;
}

export interface Selection<R> {
  items: Item<R>[];
  // Rows the measure leaves out for a missing or impossible date (e.g. never started).
  excluded: number;
}

export type Aggregate = 'sum' | 'distinct' | 'median' | 'mean' | 'share';

export interface SliceGroup {
  key: string;
  label: string;
  rowIds: Set<string>;
}

export type Cell = string | number | null;

export interface TableRow {
  id: string;
  href: string | null;
  cells: Record<string, Cell>;
}

export interface Adapter<R> {
  rows(all: WidgetRows): R[];
  rowId(row: R): string;
  inTeam(row: R, teamId: string): boolean;
  matches(row: R, filter: WidgetConfig['filter'], now: Date): boolean;
  select(rows: R[], measure: string, from: Date, to: Date, ctx: ComputeContext): Selection<R>;
  aggregate(measure: string): Aggregate;
  slice(rows: R[], field: string, ctx: ComputeContext): SliceGroup[];
  table(items: Item<R>[], rows: R[], ctx: ComputeContext): TableRow[];
  // The teams a set of rows belongs to (cycles: scope is not added across teams).
  teams?(rows: R[]): Set<string>;
  // The unit of one team's scope (cycles).
  scopeUnit?(rows: R[]): 'points' | 'issues';
}

export type ResultUnit = 'count' | 'points' | 'days' | 'percent' | 'issues';

interface ResultBase {
  excluded: number;
  capped: boolean;
  // Why the widget shows no figure (e.g. cycles of several teams).
  note?: string;
}

export type WidgetResult = ResultBase &
  (
    | { kind: 'bars'; rows: BreakdownRow[] }
    | {
        kind: 'overTime';
        series: { key: string; label: string }[];
        weeks: { week: string; values: Record<string, number> }[];
      }
    | {
        kind: 'number';
        value: number | null;
        previous: number | null;
        unit: ResultUnit;
        start: string;
        end: string;
      }
    | { kind: 'table'; columns: ColumnDef[]; rows: TableRow[] }
  );

const ADAPTERS: Record<DataKind, Adapter<unknown>> = {
  issues: issueAdapter as Adapter<unknown>,
  requests: requestAdapter as Adapter<unknown>,
  projects: projectAdapter as Adapter<unknown>,
  cycles: cycleAdapter as Adapter<unknown>,
};

export function aggregate<R>(items: Item<R>[], how: Aggregate): number | null {
  switch (how) {
    case 'sum':
      return items.reduce((n, i) => n + i.value, 0);
    case 'distinct':
      return new Set(items.map((i) => i.key).filter((k): k is string => k != null)).size;
    case 'median':
      return timeStats(items.map((i) => i.value))?.median ?? null;
    case 'mean':
      return items.length ? items.reduce((n, i) => n + i.value, 0) / items.length : null;
    case 'share':
      return items.length ? (items.reduce((n, i) => n + i.value, 0) / items.length) * 100 : null;
  }
}

const MIXED_TEAMS = 'Cycles of several teams are not added together. Pick one team.';

function uniqueRows<R>(items: Item<R>[]): R[] {
  const seen = new Map<string, R>();
  for (const i of items) if (!seen.has(i.rowId)) seen.set(i.rowId, i.row);
  return [...seen.values()];
}

function inGroup<R>(items: Item<R>[], group: SliceGroup): Item<R>[] {
  return items.filter((i) => group.rowIds.has(i.rowId));
}

function compareCells(a: Cell, b: Cell): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}

function sortedTable(rows: TableRow[], sort: string, limit: number): TableRow[] {
  const [column = '', direction] = sort.split(':');
  const sign = direction === 'asc' ? 1 : -1;
  return [...rows]
    .sort((x, y) => {
      const a = x.cells[column] ?? null;
      const b = y.cells[column] ?? null;
      // Empty cells go last whichever way the column is sorted.
      if (a == null || b == null) return compareCells(a, b);
      return sign * compareCells(a, b);
    })
    .slice(0, limit);
}

function bars<R>(
  adapter: Adapter<R>,
  def: MeasureDef,
  config: WidgetConfig,
  items: Item<R>[],
  ctx: ComputeContext,
): BreakdownRow[] {
  const how = adapter.aggregate(def.id);
  const total = aggregate(items, how);
  const shareOf = (value: number) =>
    (how === 'sum' || how === 'distinct') && total ? value / total : 0;
  const rows = uniqueRows(items);
  const segmentGroups = config.segment ? adapter.slice(rows, config.segment, ctx) : [];
  const segmentsOf = (inRow: Item<R>[]) =>
    segmentGroups.map((g) => ({
      key: g.key,
      label: g.label,
      value: aggregate(inGroup(inRow, g), how) ?? 0,
    }));
  if (!config.slice) {
    if (total == null) return [];
    return [{ key: 'all', label: def.label, value: total, share: 1, segments: segmentsOf(items) }];
  }
  const out: BreakdownRow[] = [];
  for (const group of adapter.slice(rows, config.slice, ctx)) {
    const inRow = inGroup(items, group);
    const value = aggregate(inRow, how);
    if (value == null) continue;
    out.push({
      key: group.key,
      label: group.label,
      value,
      share: shareOf(value),
      segments: segmentsOf(inRow),
    });
  }
  return out;
}

function overTime<R>(
  adapter: Adapter<R>,
  def: MeasureDef,
  config: WidgetConfig,
  list: R[],
  items: Item<R>[],
  range: { start: Date; end: Date },
  ctx: ComputeContext,
): {
  series: { key: string; label: string }[];
  weeks: { week: string; values: Record<string, number> }[];
} {
  const how = adapter.aggregate(def.id);
  const series: { key: string; label: string; items: Item<R>[]; how: Aggregate }[] = [];
  if (config.slice) {
    for (const g of adapter.slice(uniqueRows(items), config.slice, ctx))
      series.push({ key: g.key, label: g.label, items: inGroup(items, g), how });
  } else {
    series.push({ key: def.id, label: def.label, items, how });
    const compare = config.compareMeasure ? measureDef(config.data, config.compareMeasure) : null;
    if (compare && compare.basis === 'events' && compare.id !== def.id) {
      const picked = adapter.select(list, compare.id, range.start, range.end, ctx).items;
      series.push({
        key: compare.id,
        label: compare.label,
        items: picked,
        how: adapter.aggregate(compare.id),
      });
    }
  }
  const weeks = weekStarts(range).map((week) => ({ week, values: {} as Record<string, number> }));
  const byWeek = new Map(weeks.map((w) => [w.week, w]));
  for (const s of series) {
    const buckets = new Map<string, Item<R>[]>();
    for (const item of s.items) {
      if (!item.date) continue;
      const key = weekKey(new Date(item.date).getTime());
      if (!byWeek.has(key)) continue;
      buckets.set(key, [...(buckets.get(key) ?? []), item]);
    }
    for (const w of weeks) w.values[s.key] = aggregate(buckets.get(w.week) ?? [], s.how) ?? 0;
  }
  return { series: series.map(({ key, label }) => ({ key, label })), weeks };
}

function resultUnit<R>(adapter: Adapter<R>, def: MeasureDef, rows: R[]): ResultUnit {
  if (def.unit !== 'scope') return def.unit;
  return adapter.scopeUnit?.(rows) ?? 'issues';
}

export function computeWidget(widget: Widget, all: WidgetRows, ctx: ComputeContext): WidgetResult {
  const { config } = widget;
  const adapter = ADAPTERS[config.data];
  const def = measureDef(config.data, config.measure) ?? {
    id: config.measure,
    label: config.measure,
    basis: 'current',
    unit: 'count',
  };
  const capped = all.capped ?? false;
  let list = adapter.rows(all);
  if (ctx.teamId) list = list.filter((r) => adapter.inTeam(r, ctx.teamId!));
  list = list.filter((r) => adapter.matches(r, config.filter, ctx.now));
  const range = periodRange(ctx.period, ctx.now);
  const selection = adapter.select(list, def.id, range.start, range.end, ctx);
  const { items, excluded } = selection;
  const base = { excluded, capped };
  // Scope is in each team's own unit; with several teams only per-cycle or per-team
  // groups are meaningful.
  const mixed = def.unit === 'scope' && (adapter.teams?.(uniqueRows(items)).size ?? 0) > 1;
  const groupedByTeam = config.slice === 'cycle' || config.slice === 'team';

  if (widget.kind === 'number') {
    const how = adapter.aggregate(def.id);
    const previous =
      def.basis === 'events'
        ? aggregate(adapter.select(list, def.id, range.previousStart, range.start, ctx).items, how)
        : null;
    return {
      kind: 'number',
      value: mixed ? null : aggregate(items, how),
      previous: mixed ? null : previous,
      unit: resultUnit(adapter, def, uniqueRows(items)),
      start: range.start.toISOString(),
      end: range.end.toISOString(),
      ...base,
      ...(mixed ? { note: MIXED_TEAMS } : {}),
    };
  }

  if (widget.kind === 'table') {
    const table = config.table ?? { columns: [], limit: 10, sort: '' };
    const known = new Map(TABLE_COLUMNS[config.data].map((c) => [c.id, c]));
    const columns = table.columns.map((id) => known.get(id)).filter((c): c is ColumnDef => !!c);
    const rows = sortedTable(adapter.table(items, list, ctx), table.sort, table.limit).map((r) => ({
      ...r,
      cells: Object.fromEntries(columns.map((c) => [c.id, r.cells[c.id] ?? null])),
    }));
    return { kind: 'table', columns, rows, ...base };
  }

  if (mixed && !groupedByTeam) {
    const empty = config.chart === 'overTimeBars' || config.chart === 'overTimeLine';
    return empty
      ? { kind: 'overTime', series: [], weeks: [], ...base, note: MIXED_TEAMS }
      : { kind: 'bars', rows: [], ...base, note: MIXED_TEAMS };
  }
  // A measure of the current state has no weeks to show; it is drawn as bars.
  const overTimeStyle = config.chart === 'overTimeBars' || config.chart === 'overTimeLine';
  if (overTimeStyle && def.basis === 'events')
    return {
      kind: 'overTime',
      ...overTime(adapter, def, config, list, items, range, ctx),
      ...base,
    };
  return { kind: 'bars', rows: bars(adapter, def, config, items, ctx), ...base };
}
