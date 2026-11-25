import { useQuery } from '@tanstack/react-query';
import { loadFirstFeedback, loadRows } from '@/services/dashboardData.service';
import { qk } from '@/services/queryKeys';
import type { Widget } from '@/utils/dashboards/config';
import {
  firstFeedbackSince,
  loadKeyFor,
  loadSpecFor,
  type DashboardState,
} from '@/utils/dashboards/loads';

// A widget's rows, keyed by its load (utils/dashboards/loads.ts), so widgets of one
// dashboard that need the same rows share one fetch. Nothing is fetched while
// `enabled` is false (the dashboard is not open).
export function useWidgetRows(widget: Widget, dashboard: DashboardState, enabled: boolean) {
  const now = new Date();
  const key = loadKeyFor(widget, dashboard, now);
  return useQuery({
    queryKey: qk.dashboardRows(key),
    queryFn: () => loadRows(loadSpecFor(widget, dashboard, now)),
    enabled,
    staleTime: 60_000,
  });
}

// The first request of the people who first asked since the previous period's start,
// for "new people"; loaded only when a widget of an open dashboard measures it.
export function useFirstFeedback(dashboard: DashboardState, enabled: boolean) {
  const since = firstFeedbackSince(dashboard.period, new Date());
  return useQuery({
    queryKey: qk.dashboardFirstFeedback(since),
    queryFn: () => loadFirstFeedback(since),
    enabled,
    staleTime: 5 * 60_000,
  });
}
