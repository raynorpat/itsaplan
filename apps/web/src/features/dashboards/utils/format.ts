const REVENUE = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

// How widget figures read: days to one decimal ("3.5 d"), percentages whole, revenue
// compact ("1.3M"), other figures to one decimal; "–" for no figure.
export function formatValue(value: number | null, unit: string): string {
  if (value == null || !Number.isFinite(value)) return '–';
  if (unit === 'days') return `${Math.round(value * 10) / 10} d`;
  if (unit === 'percent') return `${Math.round(value)}%`;
  if (unit === 'revenue') return REVENUE.format(value);
  return String(Math.round(value * 10) / 10);
}

// A number widget's line under its figure; null when there is nothing to compare.
export function changeText(value: number | null, previous: number | null): string | null {
  if (value == null || previous == null) return null;
  if (previous === 0)
    return value === 0 ? 'Same as previous period' : 'None in the previous period';
  const change = Math.round(((value - previous) / previous) * 100);
  if (change === 0) return 'Same as previous period';
  return `${change > 0 ? '▲' : '▼'} ${Math.abs(change)}% vs previous period`;
}

// Why a widget left issues out of a time measure.
export function excludedText(measure: string, count: number): string {
  switch (measure) {
    case 'cycleTime':
      return `${count} left out (completed without being started)`;
    case 'timeToStart':
      return `${count} left out (no start date, or started before the first request)`;
    case 'timeToDone':
      return `${count} left out (completed before the first request)`;
    default:
      return `${count} left out (no date)`;
  }
}

// A bar's axis label: every label is drawn (none skipped on a narrow chart), so long
// ones are cut to fit the axis; the list under the chart has them in full.
export const axisLabel = (text: string, max = 18): string =>
  text.length > max ? `${text.slice(0, max)}…` : text;
