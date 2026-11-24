'use client';

import { useMemo } from 'react';
import { Bar, BarChart, Cell, XAxis, YAxis } from 'recharts';
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import type { FilterCondition } from '@/utils/filters';
import type { BreakdownRow } from '../utils/measures';
import { sliceFilter, type InsightsState, type SliceField } from '../utils/slices';
import { sliceColor } from '../utils/palette';

const VALUE = 'value';

// Count or points per slice as horizontal bars, stacked by segment, and a table of
// the same rows. The chart is a picture; the table carries the figures (with each
// segment's value) for screen readers, and its slice names narrow the view when
// clicked (Linear's click-through).
export default function BreakdownChart({
  rows,
  slice,
  segment,
  states,
  unit,
  onSliceFilter,
}: {
  rows: BreakdownRow[];
  slice: SliceField;
  segment: SliceField | null;
  states: ReadonlyMap<string, InsightsState>;
  unit: string;
  onSliceFilter?: (condition: FilterCondition) => void;
}) {
  // Every row lists the same segments in their natural order (measures.ts).
  const segments = useMemo(
    () => (rows[0]?.segments ?? []).map(({ key, label }) => ({ key, label })),
    [rows],
  );

  const config: ChartConfig = useMemo(() => {
    if (segments.length === 0 || !segment)
      return { [VALUE]: { label: unit, color: 'var(--primary)' } };
    return Object.fromEntries(
      segments.map((s, i) => [
        `seg_${i}`,
        { label: s.label, color: sliceColor(segment, s.key, i, states) },
      ]),
    );
  }, [segments, segment, unit, states]);

  const data = rows.map((r) => {
    const entry: Record<string, string | number> = { label: r.label, [VALUE]: r.value };
    segments.forEach((s, i) => {
      entry[`seg_${i}`] = r.segments.find((g) => g.key === s.key)?.value ?? 0;
    });
    return entry;
  });

  if (rows.length === 0) {
    return <p className="p-4 text-sm text-muted-foreground">No issues to show.</p>;
  }

  return (
    <div className="grid gap-4 p-3 lg:grid-cols-[1fr_minmax(16rem,22rem)]">
      <ChartContainer
        config={config}
        className="aspect-auto w-full"
        style={{ height: Math.max(120, rows.length * 28 + (segments.length ? 56 : 24)) }}
        aria-hidden
      >
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 0 }}>
          <XAxis type="number" tickLine={false} axisLine={false} allowDecimals={false} />
          <YAxis
            type="category"
            dataKey="label"
            tickLine={false}
            axisLine={false}
            width={130}
            tick={{ fontSize: 12 }}
          />
          <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
          {segments.length > 0 && <ChartLegend content={<ChartLegendContent />} />}
          {segments.length === 0 ? (
            <Bar dataKey={VALUE} radius={3} maxBarSize={20} isAnimationActive={false}>
              {/* Status and priority bars take the slice's own colour. */}
              {rows.map((r, i) => (
                <Cell
                  key={r.key}
                  fill={
                    slice === 'status' || slice === 'priority'
                      ? sliceColor(slice, r.key, i, states)
                      : `var(--color-${VALUE})`
                  }
                />
              ))}
            </Bar>
          ) : (
            segments.map((_, i) => (
              <Bar
                key={i}
                dataKey={`seg_${i}`}
                stackId="slice"
                maxBarSize={20}
                fill={`var(--color-seg_${i})`}
                isAnimationActive={false}
              />
            ))
          )}
        </BarChart>
      </ChartContainer>
      <table className="w-full self-start text-sm">
        <caption className="sr-only">
          {unit} by {slice}
        </caption>
        <thead className="text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="py-1 text-left font-normal">
              {slice[0]!.toUpperCase() + slice.slice(1)}
            </th>
            <th scope="col" className="py-1 pl-3 text-right font-normal whitespace-nowrap">
              {unit}
            </th>
            <th scope="col" className="py-1 pl-3 text-right font-normal whitespace-nowrap">
              Share
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const condition = onSliceFilter ? sliceFilter(slice, r.key) : null;
            return (
              <tr key={r.key} className="border-t">
                <th scope="row" className="py-1 text-left font-normal">
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
                  {segments.length > 0 && (
                    <span className="block text-xs text-muted-foreground">
                      {r.segments
                        .filter((g) => g.value > 0)
                        .map((g) => `${g.label} ${Math.round(g.value * 10) / 10}`)
                        .join(', ')}
                    </span>
                  )}
                </th>
                <td className="py-1 pl-3 text-right align-top whitespace-nowrap tabular-nums">
                  {Math.round(r.value * 10) / 10}
                </td>
                <td className="py-1 pl-3 text-right align-top whitespace-nowrap text-muted-foreground tabular-nums">
                  {Math.round(r.share * 100)}%
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
