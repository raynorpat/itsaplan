'use client';

import {
  MEASURES,
  SLICE_LABELS,
  SLICES,
  type ChartStyle,
  type WidgetConfig,
  type WidgetKind,
} from '@/utils/dashboards/config';
import DashboardSelect from './DashboardSelect';

const NONE = 'none';

// What a widget measures and how it splits it; a chart also picks bars or weekly
// bars / a line, and an over-time chart without a split may add a second measure.
export default function WidgetMeasureFields({
  kind,
  config,
  onChange,
}: {
  kind: WidgetKind;
  config: WidgetConfig;
  onChange: (patch: Partial<WidgetConfig>) => void;
}) {
  const measures = MEASURES[config.data].map((m) => ({ value: m.id, label: m.label }));
  const slices = [
    { value: NONE, label: 'No split' },
    ...SLICES[config.data].map((s) => ({ value: s, label: SLICE_LABELS[s] ?? s })),
  ];
  const overTime = config.chart === 'overTimeBars' || config.chart === 'overTimeLine';
  const fromNone = (v: string) => (v === NONE ? null : v);
  return (
    <div className="flex flex-wrap gap-2">
      <DashboardSelect
        id="widget-measure"
        label="Measure"
        value={config.measure}
        options={measures}
        onChange={(measure) => onChange({ measure })}
      />
      {kind === 'chart' && (
        <>
          <DashboardSelect
            id="widget-chart"
            label="Chart"
            value={config.chart ?? 'bars'}
            options={[
              { value: 'bars', label: 'Bars' },
              { value: 'overTimeBars', label: 'Per week (bars)' },
              { value: 'overTimeLine', label: 'Per week (line)' },
            ]}
            onChange={(chart) => onChange({ chart: chart as ChartStyle })}
          />
          <DashboardSelect
            id="widget-slice"
            label="Split by"
            value={config.slice ?? NONE}
            options={slices}
            onChange={(v) => onChange({ slice: fromNone(v) })}
          />
          {!overTime && (
            <DashboardSelect
              id="widget-segment"
              label="Then by"
              value={config.segment ?? NONE}
              options={slices}
              onChange={(v) => onChange({ segment: fromNone(v) })}
            />
          )}
          {overTime && !config.slice && (
            <DashboardSelect
              id="widget-compare"
              label="Compare with"
              value={config.compareMeasure ?? NONE}
              options={[{ value: NONE, label: 'No second measure' }, ...measures]}
              onChange={(v) => onChange({ compareMeasure: fromNone(v) })}
            />
          )}
        </>
      )}
    </div>
  );
}
