// An agent is also an assignee, so writes here invalidate the team detail as
// well, keeping the assignee picker in sync.

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { qk } from '@/services/queryKeys';
import { useInvalidateTeam } from '@/services/teams.service';

export function useAiAgentsQuery(teamKey: string | null) {
  return useQuery({
    queryKey: qk.aiAgents(teamKey ?? ''),
    queryFn: () => api.listAiAgents(teamKey!),
    enabled: teamKey != null,
  });
}

// An agent's triggered run history for the runs sidebar, paginated 25 at a time. Only
// fetched when agentId is set, so the query runs when the sidebar opens.
export function useAgentRuns(teamKey: string | null, agentId: string | null) {
  return useInfiniteQuery({
    queryKey: qk.agentRuns(teamKey ?? '', agentId ?? ''),
    queryFn: ({ pageParam }) => api.listAgentRuns(teamKey!, agentId!, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: teamKey != null && agentId != null,
  });
}

// The caller's chat threads with one agent (the AI Chat history rail), newest
// first. Only fetched when an agent is selected.
export function useAgentThreadsQuery(teamKey: string | null, agentId: string | null) {
  return useQuery({
    queryKey: qk.agentThreads(teamKey ?? '', agentId ?? ''),
    queryFn: () => api.listAiAgentThreads(teamKey!, agentId!),
    enabled: teamKey != null && agentId != null,
  });
}

// The transcript of one chat thread, to restore the conversation when a thread is
// opened. Only fetched when a thread is selected.
export function useAgentThreadMessagesQuery(
  teamKey: string | null,
  agentId: string | null,
  threadId: string | null,
) {
  return useInfiniteQuery({
    queryKey: qk.agentThreadMessages(teamKey ?? '', agentId ?? '', threadId ?? ''),
    queryFn: ({ pageParam }) =>
      api.getAiAgentThreadMessages(teamKey!, agentId!, threadId!, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextPage ?? undefined,
    enabled: teamKey != null && agentId != null && threadId != null,
  });
}

// Deletes one of the caller's chat threads with an agent and refreshes the history
// list it was in.
export function useDeleteAgentThread(teamKey: string | null, agentId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (threadId: string) => api.deleteAiAgentThread(teamKey!, agentId!, threadId),
    onSuccess: () => {
      if (teamKey && agentId != null)
        void qc.invalidateQueries({ queryKey: qk.agentThreads(teamKey, agentId) });
    },
  });
}

// The capability-tool catalog for the internal-agent form. Static per team, so
// it stays fresh for the session.
export function useAgentToolsQuery(teamKey: string | null) {
  return useQuery({
    queryKey: qk.agentTools(teamKey ?? ''),
    queryFn: () => api.listAgentTools(teamKey!),
    enabled: teamKey != null,
    staleTime: Infinity,
  });
}

export function useCreateAiAgent(teamKey: string | null) {
  const qc = useQueryClient();
  const invalidateTeam = useInvalidateTeam(teamKey);
  return useMutation({
    mutationFn: (input: Parameters<typeof api.createAiAgent>[1]) =>
      api.createAiAgent(teamKey!, input),
    onSuccess: (res) => {
      toast.success(`Agent @${res.agent.username} created`);
      if (teamKey) void qc.invalidateQueries({ queryKey: qk.aiAgents(teamKey) });
      invalidateTeam();
    },
  });
}

export function useUpdateAiAgent(teamKey: string | null) {
  const qc = useQueryClient();
  const invalidateTeam = useInvalidateTeam(teamKey);
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Parameters<typeof api.updateAiAgent>[2] }) =>
      api.updateAiAgent(teamKey!, id, patch),
    onSuccess: (agent) => {
      toast.success(`Agent @${agent.username} saved`);
      if (teamKey) void qc.invalidateQueries({ queryKey: qk.aiAgents(teamKey) });
      invalidateTeam();
    },
  });
}

export function useRegenerateAiAgentKey(teamKey: string | null) {
  return useMutation({
    mutationFn: (id: string) => api.regenerateAiAgentKey(teamKey!, id),
  });
}

export function useDeleteAiAgent(teamKey: string | null) {
  const qc = useQueryClient();
  const invalidateTeam = useInvalidateTeam(teamKey);
  return useMutation({
    mutationFn: (id: string) => api.deleteAiAgent(teamKey!, id),
    onSuccess: () => {
      if (teamKey) void qc.invalidateQueries({ queryKey: qk.aiAgents(teamKey) });
      invalidateTeam();
    },
  });
}
