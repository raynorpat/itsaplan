// The tool catalog these configured tools are built from lives in
// integrations.service.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type NewConfiguredToolInput } from '@/lib/api';
import { qk } from '@/services/queryKeys';

export function useConfiguredToolsQuery(teamKey: string | null) {
  return useQuery({
    queryKey: qk.configuredTools(teamKey ?? ''),
    queryFn: () => api.listConfiguredTools(teamKey!),
    enabled: teamKey != null,
  });
}

export function useCreateConfiguredTool(teamKey: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NewConfiguredToolInput) => api.createConfiguredTool(teamKey!, input),
    onSuccess: () => {
      if (teamKey) void qc.invalidateQueries({ queryKey: qk.configuredTools(teamKey) });
    },
  });
}

export function useDeleteConfiguredTool(teamKey: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteConfiguredTool(teamKey!, id),
    onSuccess: () => {
      if (teamKey) void qc.invalidateQueries({ queryKey: qk.configuredTools(teamKey) });
    },
  });
}

// The configured tools enabled on one agent (the agent editor's Tools section).
export function useAgentToolLinksQuery(teamKey: string | null, agentId: string | null) {
  return useQuery({
    queryKey: qk.agentToolLinks(teamKey ?? '', agentId ?? ''),
    queryFn: () => api.listAgentToolLinks(teamKey!, agentId!),
    enabled: teamKey != null && agentId != null,
  });
}

export function useSetAgentTools(teamKey: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, agentToolIds }: { agentId: string; agentToolIds: string[] }) =>
      api.setAgentTools(teamKey!, agentId, agentToolIds),
    onSuccess: (_data, { agentId }) => {
      if (teamKey) void qc.invalidateQueries({ queryKey: qk.agentToolLinks(teamKey, agentId) });
    },
  });
}
