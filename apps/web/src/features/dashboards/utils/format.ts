// How widget figures read: days to one decimal ("3.5 d"), percentages whole, other
// figures to one decimal; "–" for no figure.
export function formatValue(value: number | null, unit: string): string {
  if (value == null || !Number.isFinite(value)) return '–';
  if (unit === 'days') return `${Math.round(value * 10) / 10} d`;
  if (unit === 'percent') return `${Math.round(value)}%`;
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
