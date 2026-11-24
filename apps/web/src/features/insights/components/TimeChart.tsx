'use client';

import { useMemo } from 'react';
import { Scatter, ScatterChart, XAxis, YAxis, ZAxis } from 'recharts';
import { ChartContainer, ChartTooltip, type ChartConfig } from '@/components/ui/chart';
import { formatShortDate } from '@/utils/dates';
import type { FilterCondition } from '@/utils/filters';
import type { TimeRowsResult } from '../utils/stats';
import { sliceFilter, type SliceField } from '../utils/slices';
import { formatDays } from '../utils/panel';
import { sliceColor } from '../utils/palette';

// A time measure: a scatter of issues by date and duration, one colour per slice
// (clicking a dot opens the issue), and per slice the median and the 25th to 75th
// percentiles in a table whose slice names narrow the view.
export default function TimeChart({
  result,
  slice,
  measureLabel,
  onSliceFilter,
  onOpenIssue,
}: {
  result: TimeRowsResult;
  slice: SliceField;
  measureLabel: string;
  onSliceFilter?: (condition: FilterCondition) => void;
  onOpenIssue: (issueId: string) => void;
}) {
  const config: ChartConfig = useMemo(
    () =>
      Object.fromEntries(
        result.rows.map((r, i) => [
          `row_${i}`,
          { label: r.label, color: sliceColor(slice, r.key, i) },
        ]),
      ),
    [result.rows, slice],
  );

  if (!result.all) {
    return (
      <p className="p-4 text-sm text-muted-foreground">
        No issues with a {measureLabel.toLowerCase()} in this period.
        {result.excluded > 0 && ` ${result.excluded} completed without being started.`}
      </p>
    );
  }

  const { all } = result;
  return (
    <div className="grid gap-4 p-3 lg:grid-cols-[1fr_minmax(16rem,24rem)]">
      <div>
        <p className="mb-2 text-sm text-muted-foreground tabular-nums">
          Median {formatDays(all.median)} · 25th–75th {formatDays(all.p25)}–{formatDays(all.p75)} ·{' '}
          {all.count} {all.count === 1 ? 'issue' : 'issues'}
          {result.excluded > 0 &&
            ` · ${result.excluded} left out (completed without being started)`}
        </p>
        <ChartContainer config={config} className="aspect-auto h-56 w-full" aria-hidden>
          <ScatterChart margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
            <XAxis
              type="number"
              dataKey="t"
              domain={['dataMin', 'dataMax']}
              tickLine={false}
              axisLine={false}
              tickFormatter={(t: number) => formatShortDate(new Date(t).toISOString())}
              minTickGap={32}
            />
            <YAxis
              type="number"
              dataKey="days"
              tickLine={false}
              axisLine={false}
              width={44}
              tickFormatter={(d: number) => formatDays(d)}
            />
            <ZAxis range={[36, 36]} />
            <ChartTooltip
              cursor={false}
              content={({ payload }) => {
                const p = payload?.[0]?.payload as
                  { identifier: string; title: string; days: number } | undefined;
                if (!p) return null;
                return (
                  <div className="rounded-md border bg-background px-2 py-1 text-xs shadow-sm">
                    <span className="text-muted-foreground">{p.identifier}</span> {p.title} ·{' '}
                    {formatDays(p.days)}
                  </div>
                );
              }}
            />
            {result.rows.map((r, i) => (
              <Scatter
                key={r.key}
                name={r.label}
                data={r.points.map((p) => ({ ...p, t: new Date(p.at).getTime() }))}
                fill={`var(--color-row_${i})`}
                isAnimationActive={false}
                className="cursor-pointer"
                onClick={(point) => {
                  const id = (point.payload as { issueId?: string } | undefined)?.issueId;
                  if (id) onOpenIssue(id);
                }}
              />
            ))}
          </ScatterChart>
        </ChartContainer>
      </div>
      <table className="w-full self-start text-sm">
        <caption className="sr-only">
          {measureLabel} by {slice}
        </caption>
        <thead className="text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="py-1 text-left font-normal">
              {slice[0]!.toUpperCase() + slice.slice(1)}
            </th>
            <th scope="col" className="py-1 text-right font-normal">
              Median
            </th>
            <th scope="col" className="py-1 text-right font-normal">
              25th–75th
            </th>
            <th scope="col" className="py-1 text-right font-normal">
              Issues
            </th>
          </tr>
        </thead>
        <tbody>
          {result.rows.map((r, i) => {
            const condition = onSliceFilter ? sliceFilter(slice, r.key) : null;
            return (
              <tr key={r.key} className="border-t">
                <th scope="row" className="py-1 text-left font-normal">
                  <span
                    className="mr-1.5 inline-block size-2 rounded-full align-middle"
                    style={{ background: sliceColor(slice, r.key, i) }}
                    aria-hidden
                  />
                  {condition ? (
                    <button
                      type="button"
                      className="rounded text-left hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                      onClick={() => onSliceFilter!(condition)}
                      title={`Filter the view to ${r.label}`}
                    >
                      {r.label}
                    </button>
                  ) : (
                    r.label
                  )}
                </th>
                <td className="py-1 text-right tabular-nums">{formatDays(r.stats.median)}</td>
                <td className="py-1 text-right text-muted-foreground tabular-nums">
                  {formatDays(r.stats.p25)}–{formatDays(r.stats.p75)}
                </td>
                <td className="py-1 text-right text-muted-foreground tabular-nums">
                  {r.stats.count}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
