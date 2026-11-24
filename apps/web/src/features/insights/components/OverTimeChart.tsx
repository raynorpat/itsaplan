'use client';

import { Line, LineChart, XAxis, YAxis } from 'recharts';
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { formatShortDate } from '@/utils/dates';
import type { WeekCount } from '../utils/overTime';

const CONFIG: ChartConfig = {
  created: { label: 'Created', color: 'var(--muted-foreground)' },
  completed: { label: 'Completed', color: 'var(--primary)' },
};

// Issues created and completed per week over the period, with the same figures in a
// table for screen readers.
export default function OverTimeChart({ weeks }: { weeks: WeekCount[] }) {
  const created = weeks.reduce((n, w) => n + w.created, 0);
  const completed = weeks.reduce((n, w) => n + w.completed, 0);
  return (
    <div className="p-3">
      <p className="mb-2 text-sm text-muted-foreground tabular-nums">
        {created} created · {completed} completed
      </p>
      <ChartContainer config={CONFIG} className="aspect-auto h-56 w-full" aria-hidden>
        <LineChart data={weeks} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
          <XAxis
            dataKey="weekStart"
            tickLine={false}
            axisLine={false}
            minTickGap={32}
            tickFormatter={formatShortDate}
          />
          <YAxis tickLine={false} axisLine={false} width={28} allowDecimals={false} />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(d) => `Week of ${formatShortDate(String(d))}`}
              />
            }
          />
          <ChartLegend content={<ChartLegendContent />} />
          <Line
            dataKey="created"
            stroke="var(--color-created)"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
          <Line
            dataKey="completed"
            stroke="var(--color-completed)"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ChartContainer>
      <table className="sr-only">
        <caption>Issues created and completed per week</caption>
        <thead>
          <tr>
            <th scope="col">Week of</th>
            <th scope="col">Created</th>
            <th scope="col">Completed</th>
          </tr>
        </thead>
        <tbody>
          {weeks.map((w) => (
            <tr key={w.weekStart}>
              <th scope="row">{w.weekStart}</th>
              <td>{w.created}</td>
              <td>{w.completed}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
