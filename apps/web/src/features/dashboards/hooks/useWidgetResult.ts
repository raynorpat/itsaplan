import { useMemo } from 'react';
import { useFirstFeedback, useWidgetRows } from '@/hooks/useWidgetRows';
import { computeWidget, type ComputeContext } from '@/utils/dashboards/compute';
import type { Widget } from '@/utils/dashboards/config';
import type { DashboardState } from '@/utils/dashboards/loads';
import { EMPTY_CONTEXT } from '@/utils/insights/context';
import { widgetInsightsContext } from '../utils/context';

// A widget's loaded rows and figures for the dashboard's period and team. "New people"
// also needs each person's first request (the People list).
export function useWidgetResult(widget: Widget, dashboard: DashboardState, enabled: boolean) {
  const rows = useWidgetRows(widget, dashboard, enabled);
  const needsFirst = widget.config.data === 'requests' && widget.config.measure === 'newPeople';
  const first = useFirstFeedback(enabled && needsFirst);
  const ready = rows.data && (!needsFirst || first.data);
  const ctx: ComputeContext | null = useMemo(
    () =>
      ready
        ? {
            now: new Date(),
            period: dashboard.period,
            teamId: dashboard.teamId,
            insights: widgetInsightsContext(rows.data?.names ?? EMPTY_CONTEXT, dashboard.teamId),
            firstFeedback: first.data ?? new Map(),
          }
        : null,
    [ready, dashboard.period, dashboard.teamId, rows.data, first.data],
  );
  const result = useMemo(
    () => (ctx && rows.data ? computeWidget(widget, rows.data, ctx) : null),
    [widget, rows.data, ctx],
  );
  return {
    rows: rows.data ?? null,
    ctx,
    result,
    isPending: rows.isPending || (needsFirst && first.isPending),
    error: rows.error ?? first.error ?? null,
  };
}
