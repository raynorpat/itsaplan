import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { qk } from '@/services/queryKeys';

export function useWebhooksQuery(teamKey: string | null) {
  return useQuery({
    queryKey: qk.webhooks(teamKey ?? ''),
    queryFn: () => api.listWebhooks(teamKey!),
    enabled: teamKey != null,
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

export function useCreateWebhook(teamKey: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ input }: { input: Parameters<typeof api.createWebhook>[1] }) =>
      api.createWebhook(teamKey!, input),
    onSuccess: () => {
      if (teamKey) void qc.invalidateQueries({ queryKey: qk.webhooks(teamKey) });
    },
  });
}

export function useUpdateWebhook(teamKey: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof api.updateWebhook>[1] }) =>
      api.updateWebhook(id, input),
    onSuccess: () => {
      if (teamKey) void qc.invalidateQueries({ queryKey: qk.webhooks(teamKey) });
    },
  });
}

export function useDeleteWebhook(teamKey: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteWebhook(id),
    onSuccess: () => {
      if (teamKey) void qc.invalidateQueries({ queryKey: qk.webhooks(teamKey) });
    },
  });
}
