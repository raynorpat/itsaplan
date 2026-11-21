import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { qk } from '@/services/queryKeys';

export function useAgentSchedules(teamKey: string) {
  return useQuery({
    queryKey: qk.agentSchedules(teamKey),
    queryFn: () => api.listAgentSchedules(teamKey),
    refetchInterval: (query) =>
      query.state.data?.some((schedule) => schedule.lastRunStatus === 'pending') ? 2000 : false,
  });
}

export function useAgentScheduleRuns(teamKey: string, scheduleId: string | null) {
  return useQuery({
    queryKey: qk.agentScheduleRuns(teamKey, scheduleId ?? ''),
    queryFn: () => api.listAgentScheduleRuns(teamKey, scheduleId!),
    enabled: scheduleId != null,
    refetchInterval: (query) =>
      query.state.data?.some((run) => run.status === 'pending') ? 2000 : false,
  });
}

export function useCreateAgentSchedule(teamKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof api.createAgentSchedule>[1]) =>
      api.createAgentSchedule(teamKey, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.agentSchedules(teamKey) }),
  });
}

export function useUpdateAgentSchedule(teamKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: string;
      patch: Parameters<typeof api.updateAgentSchedule>[2];
    }) => api.updateAgentSchedule(teamKey, id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.agentSchedules(teamKey) }),
  });
}

export function useDeleteAgentSchedule(teamKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteAgentSchedule(teamKey, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.agentSchedules(teamKey) }),
  });
}

export function useRunAgentSchedule(teamKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.runAgentSchedule(teamKey, id),
    onSuccess: (_data, id) => {
      void qc.invalidateQueries({ queryKey: qk.agentSchedules(teamKey) });
      void qc.invalidateQueries({ queryKey: qk.agentScheduleRuns(teamKey, id) });
    },
  });
}
