'use client';

import { Bar, BarChart, XAxis, YAxis } from 'recharts';
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import type { BreakdownRow } from '@/utils/insights/measures';
import { axisLabel, formatValue } from '../utils/format';

const SEGMENT_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
];

// Horizontal bars per slice, stacked by segment, with a table of the same figures
// whose slice names open the slice's items (the side panel).
export default function WidgetBars({
  rows,
  unit,
  sliceLabel,
  onSlice,
}: {
  rows: BreakdownRow[];
  unit: string;
  sliceLabel: string;
  onSlice: (key: string, label: string) => void;
}) {
  if (rows.length === 0)
    return <p className="py-6 text-sm text-muted-foreground">Nothing to show.</p>;
  const segments = (rows[0]?.segments ?? []).map(({ key, label }) => ({ key, label }));
  const config: ChartConfig = segments.length
    ? Object.fromEntries(
        segments.map((s, i) => [`seg_${i}`, { label: s.label, color: SEGMENT_COLORS[i % 5] }]),
      )
    : { value: { label: unit, color: 'var(--primary)' } };
  const data = rows.map((r) => {
    const entry: Record<string, string | number> = { label: r.label, value: r.value };
    segments.forEach((s, i) => {
      entry[`seg_${i}`] = r.segments.find((g) => g.key === s.key)?.value ?? 0;
    });
    return entry;
  });
  return (
    <div className="grid gap-3">
      <ChartContainer
        config={config}
        className="aspect-auto w-full"
        style={{ height: Math.max(100, rows.length * 26 + (segments.length ? 48 : 16)) }}
        aria-hidden
      >
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 0 }}>
          <XAxis type="number" tickLine={false} axisLine={false} allowDecimals={false} />
          <YAxis
            type="category"
            dataKey="label"
            tickLine={false}
            axisLine={false}
            width={120}
            interval={0}
            tickFormatter={(v: string) => axisLabel(v)}
            tick={{ fontSize: 12 }}
          />
          <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
          {segments.length > 0 && <ChartLegend content={<ChartLegendContent />} />}
          {segments.length === 0 ? (
            <Bar
              dataKey="value"
              fill="var(--color-value)"
              radius={3}
              maxBarSize={18}
              isAnimationActive={false}
            />
          ) : (
            segments.map((_, i) => (
              <Bar
                key={i}
                dataKey={`seg_${i}`}
                stackId="s"
                fill={`var(--color-seg_${i})`}
                maxBarSize={18}
                isAnimationActive={false}
              />
            ))
          )}
        </BarChart>
      </ChartContainer>
      <table className="w-full text-sm">
        <caption className="sr-only">
          {unit} by {sliceLabel}
        </caption>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t">
              <th scope="row" className="py-1 text-left font-normal">
                <button
                  type="button"
                  className="rounded text-left hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  onClick={() => onSlice(r.key, r.label)}
                >
                  {r.label}
                </button>
              </th>
              <td className="py-1 pl-3 text-right whitespace-nowrap tabular-nums">
                {formatValue(r.value, unit)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
