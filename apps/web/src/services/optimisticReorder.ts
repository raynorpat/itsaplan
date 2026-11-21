import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';

// Reorder mutation for a team's ordered lists (views, dashboards, actions).
// Optimistically reorders the cached list so the drag lands immediately, rolls
// back on error, and refetches on settle to reconcile with the server's
// renumbered positions. Pass a null key to disable the cache work when there is
// no team.
export function useOptimisticReorder<T extends { id: string }>(
  queryKey: QueryKey | null,
  reorder: (orderedIds: string[]) => Promise<unknown>,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (orderedIds: string[]) => reorder(orderedIds),
    onMutate: async (orderedIds) => {
      if (!queryKey) return;
      await qc.cancelQueries({ queryKey });
      const previous = qc.getQueryData<T[]>(queryKey);
      if (previous) {
        const byId = new Map(previous.map((item) => [item.id, item]));
        const next = orderedIds.map((id) => byId.get(id)).filter((item): item is T => !!item);
        qc.setQueryData<T[]>(queryKey, next);
      }
      return { previous };
    },
    onError: (_err, _orderedIds, ctx) => {
      if (queryKey && ctx?.previous) qc.setQueryData(queryKey, ctx.previous);
    },
    onSettled: () => {
      if (queryKey) void qc.invalidateQueries({ queryKey });
    },
  });
}
