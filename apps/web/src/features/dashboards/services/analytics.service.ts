// Read-only analytics queries behind the dashboard widgets. Each hook wraps an
// api.ts call and is keyed by qk.analytics(teamKey, kind, params) so widgets
// with different windows/filters cache independently. Feature-local: only the
// dashboards feature reads these.

import { useQuery } from '@tanstack/react-query';
import { api, type PulseUnit } from '@/lib/api';
import type { BreakdownBy } from '@/utils/dashboardWidgets';
import { qk } from '@/services/queryKeys';

export function useBreakdownQuery(teamKey: string, by: BreakdownBy) {
  return useQuery({
    queryKey: qk.analytics(teamKey, 'breakdown', { by }),
    queryFn: () => api.getBreakdown(teamKey, by),
  });
}

export function usePulseQuery(teamKey: string, unit: PulseUnit, columns: number) {
  return useQuery({
    queryKey: qk.analytics(teamKey, 'pulse', { unit, columns }),
    queryFn: () => api.getPulse(teamKey, unit, columns),
  });
}

export function useThroughputQuery(teamKey: string, weeks: number) {
  return useQuery({
    queryKey: qk.analytics(teamKey, 'throughput', { weeks }),
    queryFn: () => api.getThroughput(teamKey, weeks),
  });
}

export function useAgentRunsQuery(
  teamKey: string,
  params: { status: string | null; limit: number },
) {
  return useQuery({
    queryKey: qk.analytics(teamKey, 'agent-runs', params),
    queryFn: () => api.getAgentRuns(teamKey, params),
  });
}

export function useAgentRunStatsQuery(teamKey: string, days: number) {
  return useQuery({
    queryKey: qk.analytics(teamKey, 'agent-run-stats', { days }),
    queryFn: () => api.getAgentRunStats(teamKey, days),
  });
}

export function useWebhookStatsQuery(teamKey: string, days: number) {
  return useQuery({
    queryKey: qk.analytics(teamKey, 'webhook-stats', { days }),
    queryFn: () => api.getWebhookStats(teamKey, days),
  });
}

export function useAgentWorkloadQuery(teamKey: string) {
  return useQuery({
    queryKey: qk.analytics(teamKey, 'agent-workload'),
    queryFn: () => api.getAgentWorkload(teamKey),
  });
}

export function useActivityFeedQuery(
  teamKey: string,
  params: { action: string | null; issueIds: string[] | null; limit: number },
) {
  return useQuery({
    queryKey: qk.analytics(teamKey, 'activity', params),
    queryFn: () => api.listActivity(teamKey, params),
  });
}
