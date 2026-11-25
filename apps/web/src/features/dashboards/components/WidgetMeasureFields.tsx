'use client';

import {
  CUSTOMER_MEASURES,
  CUSTOMER_SLICES,
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
// bars / a line, and an over-time chart without a split may add a second measure. The
// customer measures and splits are offered only while Customers is on.
export default function WidgetMeasureFields({
  kind,
  config,
  customersOn,
  onChange,
}: {
  kind: WidgetKind;
  config: WidgetConfig;
  customersOn: boolean;
  onChange: (patch: Partial<WidgetConfig>) => void;
}) {
  const offered = (id: string, customerIds: Set<string>) =>
    customersOn || config.data === 'customers' || !customerIds.has(id);
  const measures = MEASURES[config.data]
    .filter((m) => offered(m.id, CUSTOMER_MEASURES))
    .map((m) => ({ value: m.id, label: m.label }));
  const slices = [
    { value: NONE, label: 'No split' },
    ...SLICES[config.data]
      .filter((s) => offered(s, CUSTOMER_SLICES))
      .map((s) => ({ value: s, label: SLICE_LABELS[s] ?? s })),
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
