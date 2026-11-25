import { measureDef, SLICE_LABELS, type Widget } from './config';
import type { Cell, WidgetResult } from './compute';

// A widget's figures as CSV (RFC 4180): exactly what the widget shows, no more.

// Spreadsheets run a cell that starts with one of these as a formula.
const FORMULA_START = /^[=+\-@\t\r]/;

function field(value: Cell | undefined): string {
  if (value == null) return '';
  if (typeof value === 'number') return String(Math.round(value * 100) / 100);
  const text = FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const line = (cells: (Cell | undefined)[]) => cells.map(field).join(',') + '\r\n';

export function toCsv(widget: Widget, result: WidgetResult): string {
  const { config } = widget;
  const measure = measureDef(config.data, config.measure)?.label ?? config.measure;
  const sliceLabel = config.slice ? (SLICE_LABELS[config.slice] ?? config.slice) : 'Measure';
  switch (result.kind) {
    case 'bars': {
      if (config.segment) {
        const segmentLabel = SLICE_LABELS[config.segment] ?? config.segment;
        let out = line([sliceLabel, segmentLabel, measure]);
        for (const row of result.rows)
          for (const s of row.segments) out += line([row.label, s.label, s.value]);
        return out;
      }
      // Only sums and counts have shares; a median's or a percentage's would read 0.0%.
      if (!result.shares) {
        let out = line([sliceLabel, measure]);
        for (const row of result.rows) out += line([row.label, row.value]);
        return out;
      }
      let out = line([sliceLabel, measure, 'Share']);
      for (const row of result.rows)
        out += line([row.label, row.value, `${(row.share * 100).toFixed(1)}%`]);
      return out;
    }
    case 'overTime': {
      let out = line(['Week', ...result.series.map((s) => s.label)]);
      for (const w of result.weeks)
        out += line([w.week, ...result.series.map((s) => w.values[s.key] ?? 0)]);
      return out;
    }
    case 'number':
      return (
        line(['Measure', 'Period start', 'Period end', 'Value', 'Previous']) +
        line([
          measure,
          result.start.slice(0, 10),
          result.end.slice(0, 10),
          result.value,
          result.previous,
        ])
      );
    case 'table': {
      let out = line(result.columns.map((c) => c.label));
      for (const row of result.rows) out += line(result.columns.map((c) => row.cells[c.id]));
      return out;
    }
  }
}

// The number of data rows in a CSV this module wrote (records after the header; a
// newline inside a quoted cell does not end a record).
export function csvRowCount(csv: string): number {
  let records = 0;
  let quoted = false;
  let inRecord = false;
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    if (c === '"') quoted = !quoted;
    if (!quoted && (c === '\n' || (c === '\r' && csv[i + 1] !== '\n'))) {
      if (inRecord) records++;
      inRecord = false;
    } else if (c !== '\r') inRecord = true;
  }
  if (inRecord) records++;
  return Math.max(0, records - 1);
}
