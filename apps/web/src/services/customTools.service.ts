// The tool catalog these configured tools are built from lives in
// integrations.service.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type NewConfiguredToolInput } from '@/lib/api';
import { qk } from '@/services/queryKeys';

export function useConfiguredToolsQuery(projectKey: string | null) {
  return useQuery({
    queryKey: qk.configuredTools(projectKey ?? ''),
    queryFn: () => api.listConfiguredTools(projectKey!),
    enabled: projectKey != null,
  });
}

export function useCreateConfiguredTool(projectKey: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NewConfiguredToolInput) => api.createConfiguredTool(projectKey!, input),
    onSuccess: () => {
      if (projectKey) void qc.invalidateQueries({ queryKey: qk.configuredTools(projectKey) });
    },
  });
}

export function useDeleteConfiguredTool(projectKey: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteConfiguredTool(projectKey!, id),
    onSuccess: () => {
      if (projectKey) void qc.invalidateQueries({ queryKey: qk.configuredTools(projectKey) });
    },
  });
}

// The configured tools enabled on one agent (the agent editor's Tools section).
export function useAgentToolLinksQuery(projectKey: string | null, agentId: string | null) {
  return useQuery({
    queryKey: qk.agentToolLinks(projectKey ?? '', agentId ?? ''),
    queryFn: () => api.listAgentToolLinks(projectKey!, agentId!),
    enabled: projectKey != null && agentId != null,
  });
}

export function useSetAgentTools(projectKey: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, agentToolIds }: { agentId: string; agentToolIds: string[] }) =>
      api.setAgentTools(projectKey!, agentId, agentToolIds),
    onSuccess: (_data, { agentId }) => {
      if (projectKey)
        void qc.invalidateQueries({ queryKey: qk.agentToolLinks(projectKey, agentId) });
    },
  });
}
