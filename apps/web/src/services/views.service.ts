import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type View } from '@/lib/api';
import { EMPTY_FILTER_SET, type FilterSet } from '@/utils/filters';
import { normalizeSavedDisplay } from '@/utils/viewSettings';
import { qk } from '@/services/queryKeys';

// Coerces a view's jsonb blobs (opaque on the server) into the client shapes,
// filling defaults for a missing/partial display or filter set. Applied by the
// views query and after a create/update so consumers always get client shapes.
export function normalizeView(v: View): View {
  const conditions = (v.filters as FilterSet | undefined)?.conditions;
  return {
    ...v,
    filters: Array.isArray(conditions) ? { conditions } : EMPTY_FILTER_SET,
    display: normalizeSavedDisplay(v.display),
  };
}

export function useViewsQuery(teamKey: string | null) {
  return useQuery({
    queryKey: qk.views(teamKey ?? ''),
    queryFn: () => api.listViews(teamKey!),
    enabled: teamKey != null,
    select: (rows) => rows.map(normalizeView),
  });
}

export function useCreateView(teamKey: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ input }: { input: Parameters<typeof api.createView>[1] }) =>
      api.createView(teamKey!, input),
    onSuccess: () => {
      if (teamKey) void qc.invalidateQueries({ queryKey: qk.views(teamKey) });
    },
  });
}

export function useUpdateView(teamKey: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof api.updateView>[1] }) =>
      api.updateView(id, input),
    onSuccess: () => {
      if (teamKey) void qc.invalidateQueries({ queryKey: qk.views(teamKey) });
    },
  });
}

export function useDeleteView(teamKey: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteView(id),
    onSuccess: () => {
      if (teamKey) void qc.invalidateQueries({ queryKey: qk.views(teamKey) });
    },
  });
}
