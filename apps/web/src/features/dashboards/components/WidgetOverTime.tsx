'use client';

import { Bar, BarChart, Line, LineChart, XAxis, YAxis } from 'recharts';
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { formatShortDate } from '@/utils/dates';

const COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
];

// Weekly bars (stacked by series) or lines over the dashboard's period.
export default function WidgetOverTime({
  series,
  weeks,
  line,
}: {
  series: { key: string; label: string }[];
  weeks: { week: string; values: Record<string, number> }[];
  line: boolean;
}) {
  if (series.length === 0 || weeks.length === 0)
    return <p className="py-6 text-sm text-muted-foreground">Nothing to show.</p>;
  const config: ChartConfig = Object.fromEntries(
    series.map((s, i) => [`s_${i}`, { label: s.label, color: COLORS[i % 5] }]),
  );
  const data = weeks.map((w) => ({
    week: w.week,
    ...Object.fromEntries(series.map((s, i) => [`s_${i}`, w.values[s.key] ?? 0])),
  }));
  const axes = (
    <>
      <XAxis
        dataKey="week"
        tickLine={false}
        axisLine={false}
        minTickGap={32}
        tickFormatter={formatShortDate}
      />
      <YAxis tickLine={false} axisLine={false} width={32} allowDecimals={false} />
      <ChartTooltip
        content={
          <ChartTooltipContent labelFormatter={(d) => `Week of ${formatShortDate(String(d))}`} />
        }
      />
      {series.length > 1 && <ChartLegend content={<ChartLegendContent />} />}
    </>
  );
  return (
    <ChartContainer config={config} className="aspect-auto h-52 w-full">
      {line ? (
        <LineChart data={data} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
          {axes}
          {series.map((_, i) => (
            <Line
              key={i}
              dataKey={`s_${i}`}
              stroke={`var(--color-s_${i})`}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      ) : (
        <BarChart data={data} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
          {axes}
          {series.map((_, i) => (
            <Bar
              key={i}
              dataKey={`s_${i}`}
              stackId="w"
              fill={`var(--color-s_${i})`}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      )}
    </ChartContainer>
  );
}
