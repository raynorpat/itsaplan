import {
  MEASURES,
  TABLE_COLUMNS,
  type DataKind,
  type TableConfig,
  type Widget,
  type WidgetKind,
} from '@/utils/dashboards/config';

// Widget order and grid packing, the starting widget for each kind of data, and where
// a dashboard's period and team are kept in this browser.

export function moveWidget(widgets: Widget[], from: number, to: number): Widget[] {
  if (from < 0 || from >= widgets.length || to < 0 || to >= widgets.length) return widgets;
  const next = [...widgets];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}

// Rows of the grid in order: two half widgets side by side, a full widget alone. A
// half widget followed by a full one sits alone in its row.
export function rowsOf(widgets: Widget[]): Widget[][] {
  const rows: Widget[][] = [];
  let open: Widget[] | null = null;
  for (const w of widgets) {
    if (w.width === 'full') {
      open = null;
      rows.push([w]);
    } else if (open && open.length === 1) {
      open.push(w);
      open = null;
    } else {
      open = [w];
      rows.push(open);
    }
  }
  return rows;
}

const DEFAULTS: Record<DataKind, { measure: string; slice: string | null; title: string }> = {
  issues: { measure: 'open', slice: 'status', title: 'Open issues by status' },
  requests: { measure: 'requests', slice: 'source', title: 'Requests by source' },
  projects: { measure: 'projects', slice: 'health', title: 'Projects by health' },
  cycles: { measure: 'completedScope', slice: 'cycle', title: 'Completed scope per cycle' },
};

export function newWidget(data: DataKind): Widget {
  const d = DEFAULTS[data];
  // Every default measure exists for its data kind (config.ts).
  const measure = MEASURES[data].some((m) => m.id === d.measure)
    ? d.measure
    : MEASURES[data][0]!.id;
  return {
    id: crypto.randomUUID(),
    kind: 'chart',
    width: 'half',
    config: {
      title: d.title,
      data,
      filter: data === 'issues' || data === 'requests' ? [] : {},
      measure,
      slice: d.slice,
      segment: null,
      chart: 'bars',
    },
  };
}

// Kept per user and dashboard, as Insights settings are.
export const dashboardFilterKey = (userId: string, dashboardId: string): string =>
  `dashboard-filters:${userId}:${dashboardId}`;

// A table's starting columns (the first four of its data kind), 10 rows, sorted by the
// last of them, highest first.
function defaultTable(data: DataKind): TableConfig {
  const columns = TABLE_COLUMNS[data].slice(0, 4).map((c) => c.id);
  return { columns, limit: 10, sort: `${columns[columns.length - 1]}:desc` };
}

// The widget shown as a chart, a number or a table; a table keeps (or gets) its setup,
// the others drop it.
export function withKind(widget: Widget, kind: WidgetKind): Widget {
  const { table, ...config } = widget.config;
  if (kind !== 'table') return { ...widget, kind, config };
  return { ...widget, kind, config: { ...config, table: table ?? defaultTable(config.data) } };
}

// The widget over another kind of data: that kind's starting measure, slice and filter,
// keeping the title, display and width.
export function withData(widget: Widget, data: DataKind): Widget {
  const fresh = newWidget(data);
  return withKind(
    { ...widget, config: { ...fresh.config, title: widget.config.title } },
    widget.kind,
  );
}

// Weekly bars stack the slices of one measure; two compared measures (created and
// completed) are drawn side by side, since their sum means nothing.
export function overTimeStacked(widget: Widget): boolean {
  return !widget.config.compareMeasure;
}
