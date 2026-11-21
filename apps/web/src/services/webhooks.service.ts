import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, type NewWebhookInput } from '@/lib/api';
import { qk } from '@/services/queryKeys';

export function useWebhooksQuery(teamKey: string | null) {
  return useQuery({
    queryKey: qk.webhooks(teamKey ?? ''),
    queryFn: () => api.listWebhooks(teamKey!),
    enabled: teamKey != null,
  });
}

// All-teams webhooks. Resolves to null for a user who may not manage them (403),
// which also hides the "All teams" option.
export function useAllTeamsWebhooksQuery() {
  return useQuery({
    queryKey: qk.allTeamsWebhooks,
    queryFn: async () => {
      try {
        return await api.listAllTeamsWebhooks();
      } catch (error) {
        if (error instanceof ApiError && error.status === 403) return null;
        throw error;
      }
    },
    retry: false,
  });
}

// A webhook's deliveries for the history sidebar, paginated 25 at a time. Only
// fetched when webhookId is set, so the query runs when the sidebar opens.
export function useWebhookDeliveries(webhookId: string | null) {
  return useInfiniteQuery({
    queryKey: qk.webhookDeliveries(webhookId ?? ''),
    queryFn: ({ pageParam }) => api.listWebhookDeliveries(webhookId!, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: webhookId != null,
  });
}

// Every webhook mutation refreshes the team list and the all-teams list (both are
// under the 'webhooks' key).
function useInvalidateWebhooks() {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ queryKey: ['webhooks'] });
}

export function useCreateWebhook(teamKey: string | null) {
  const invalidate = useInvalidateWebhooks();
  return useMutation({
    mutationFn: ({ input, allTeams }: { input: NewWebhookInput; allTeams: boolean }) =>
      allTeams ? api.createAllTeamsWebhook(input) : api.createWebhook(teamKey!, input),
    onSuccess: invalidate,
  });
}

export function useUpdateWebhook() {
  const invalidate = useInvalidateWebhooks();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof api.updateWebhook>[1] }) =>
      api.updateWebhook(id, input),
    onSuccess: invalidate,
  });
}

export function useRotateWebhookSecret() {
  const invalidate = useInvalidateWebhooks();
  return useMutation({
    mutationFn: (id: string) => api.rotateWebhookSecret(id),
    onSuccess: invalidate,
  });
}

export function useDeleteWebhook() {
  const invalidate = useInvalidateWebhooks();
  return useMutation({
    mutationFn: (id: string) => api.deleteWebhook(id),
    onSuccess: invalidate,
  });
}
