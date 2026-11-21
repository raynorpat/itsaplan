import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Dashboard } from '@/lib/api';
import { useOptimisticReorder } from '@/services/optimisticReorder';
import { qk } from '@/services/queryKeys';

export function useDashboardsQuery(teamKey: string | null) {
  return useQuery({
    queryKey: qk.dashboards(teamKey ?? ''),
    queryFn: () => api.listDashboards(teamKey!),
    enabled: teamKey != null,
  });
}

export function useCreateDashboard(teamKey: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ input }: { input: Parameters<typeof api.createDashboard>[1] }) =>
      api.createDashboard(teamKey!, input),
    onSuccess: () => {
      if (teamKey) void qc.invalidateQueries({ queryKey: qk.dashboards(teamKey) });
    },
  });
}

export function useUpdateDashboard(teamKey: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof api.updateDashboard>[1] }) =>
      api.updateDashboard(id, input),
    onSuccess: () => {
      if (teamKey) void qc.invalidateQueries({ queryKey: qk.dashboards(teamKey) });
    },
  });
}

export function useDeleteDashboard(teamKey: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteDashboard(id),
    onSuccess: () => {
      if (teamKey) void qc.invalidateQueries({ queryKey: qk.dashboards(teamKey) });
    },
  });
}

export function useReorderDashboards(teamKey: string | null) {
  return useOptimisticReorder<Dashboard>(teamKey ? qk.dashboards(teamKey) : null, (orderedIds) =>
    api.reorderDashboards(teamKey!, orderedIds),
  );
}
