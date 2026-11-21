import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type ActionDef } from '@/lib/api';
import { EMPTY_FILTER_SET, type FilterSet } from '@/utils/filters';
import { useOptimisticReorder } from '@/services/optimisticReorder';
import { qk } from '@/services/queryKeys';

// Coerces an action's jsonb blobs (opaque on the server) into the client shapes:
// a FilterSet condition (empty when missing/partial) and an effect object.
// Applied by the actions query and after a create/update.
export function normalizeAction(a: ActionDef): ActionDef {
  const conditions = (a.condition as FilterSet | undefined)?.conditions;
  return {
    ...a,
    condition: Array.isArray(conditions) ? { conditions } : EMPTY_FILTER_SET,
    effect: a.effect && typeof a.effect === 'object' ? a.effect : {},
  };
}

export function useActionsQuery(teamKey: string | null) {
  return useQuery({
    queryKey: qk.actions(teamKey ?? ''),
    queryFn: () => api.listActions(teamKey!),
    enabled: teamKey != null,
    select: (rows) => rows.map(normalizeAction),
  });
}

export function useCreateAction(teamKey: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ input }: { input: Parameters<typeof api.createAction>[1] }) =>
      api.createAction(teamKey!, input),
    onSuccess: () => {
      if (teamKey) void qc.invalidateQueries({ queryKey: qk.actions(teamKey) });
    },
  });
}

export function useUpdateAction(teamKey: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof api.updateAction>[1] }) =>
      api.updateAction(id, input),
    onSuccess: () => {
      if (teamKey) void qc.invalidateQueries({ queryKey: qk.actions(teamKey) });
    },
  });
}

export function useDeleteAction(teamKey: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteAction(id),
    onSuccess: () => {
      if (teamKey) void qc.invalidateQueries({ queryKey: qk.actions(teamKey) });
    },
  });
}

export function useReorderActions(teamKey: string | null) {
  return useOptimisticReorder<ActionDef>(teamKey ? qk.actions(teamKey) : null, (orderedIds) =>
    api.reorderActions(teamKey!, orderedIds),
  );
}
