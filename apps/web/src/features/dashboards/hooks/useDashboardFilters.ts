import { useEffect, useState } from 'react';
import { DASHBOARD_PERIODS, DEFAULT_PERIOD, type DashboardPeriod } from '@/utils/dashboards/config';
import type { DashboardState } from '@/utils/dashboards/loads';
import { dashboardFilterKey } from '../utils/layout';

const DEFAULT: DashboardState = { period: DEFAULT_PERIOD, teamId: null };

function read(id: string): DashboardState {
  if (typeof window === 'undefined') return DEFAULT;
  try {
    const raw = JSON.parse(window.localStorage.getItem(dashboardFilterKey(id)) ?? 'null') as {
      period?: unknown;
      teamId?: unknown;
    } | null;
    return {
      period: DASHBOARD_PERIODS.includes(raw?.period as DashboardPeriod)
        ? (raw!.period as DashboardPeriod)
        : DEFAULT_PERIOD,
      teamId: typeof raw?.teamId === 'string' ? raw.teamId : null,
    };
  } catch {
    return DEFAULT;
  }
}

// A dashboard's period and team, kept per dashboard in this browser (as Insights
// settings are). Read after mount so the server render and the first client render
// agree.
export function useDashboardFilters(id: string) {
  const [state, setState] = useState<DashboardState>(DEFAULT);
  useEffect(() => setState(read(id)), [id]);
  const update = (patch: Partial<DashboardState>) =>
    setState((prev) => {
      const next = { ...prev, ...patch };
      window.localStorage.setItem(dashboardFilterKey(id), JSON.stringify(next));
      return next;
    });
  return [state, update] as const;
}
