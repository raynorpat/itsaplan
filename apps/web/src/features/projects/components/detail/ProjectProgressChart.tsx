'use client';

import { useMemo } from 'react';
import { Area, ComposedChart, Line, ReferenceLine, XAxis, YAxis } from 'recharts';
import type { ProjectDetail } from '@/services/projects.service';
import { formatShortDate } from '@/utils/dates';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { chartDays, progressHeader, progressSeries, progressUnit } from '../../utils/progressChart';

const CONFIG: ChartConfig = {
  scope: { label: 'Scope', color: 'var(--muted-foreground)' },
  started: { label: 'Started', color: 'var(--color-amber-500)' },
  completed: { label: 'Completed', color: 'var(--primary)' },
};

// The project's scope, started and completed work per day (Linear's progress graph):
// scope as a line, started and completed as stacked areas, and the target date as a
// dashed line.
export default function ProjectProgressChart({ project }: { project: ProjectDetail }) {
  const { history, targetDate } = project;
  const series = useMemo(
    () =>
      progressSeries({ ...history, startDate: project.startDate, createdAt: project.createdAt }),
    [history, project.startDate, project.createdAt],
  );
  const days = useMemo(() => chartDays(series, targetDate), [series, targetDate]);
  const last = series[series.length - 1];

  return (
    <section>
      <h4 className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        Progress
      </h4>
      {last ? (
        <>
          <p className="mb-3 text-sm text-muted-foreground tabular-nums">
            {progressHeader(last, progressUnit(history))}
          </p>
          <ChartContainer
            config={CONFIG}
            className="aspect-auto h-48 w-full"
            role="img"
            aria-label={`Project progress over ${series.length} days. ${progressHeader(last, progressUnit(history))}.`}
          >
            <ComposedChart data={days} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                minTickGap={32}
                tickFormatter={formatShortDate}
              />
              <YAxis tickLine={false} axisLine={false} width={28} allowDecimals={false} />
              <ChartTooltip
                content={<ChartTooltipContent labelFormatter={(d) => formatShortDate(String(d))} />}
              />
              <Area
                dataKey="completed"
                stackId="work"
                type="stepAfter"
                fill="var(--color-completed)"
                fillOpacity={0.35}
                stroke="var(--color-completed)"
                isAnimationActive={false}
              />
              <Area
                dataKey="started"
                stackId="work"
                type="stepAfter"
                fill="var(--color-started)"
                fillOpacity={0.3}
                stroke="var(--color-started)"
                isAnimationActive={false}
              />
              <Line
                dataKey="scope"
                type="stepAfter"
                stroke="var(--color-scope)"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
              {targetDate && (
                <ReferenceLine
                  x={targetDate}
                  stroke="var(--muted-foreground)"
                  strokeDasharray="4 4"
                  label={{ value: 'Target', position: 'insideTopRight', fontSize: 11 }}
                />
              )}
            </ComposedChart>
          </ChartContainer>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">No progress recorded yet.</p>
      )}
    </section>
  );
}
