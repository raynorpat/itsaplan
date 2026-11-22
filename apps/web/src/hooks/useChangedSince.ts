import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query';
import { mergeChanged } from '@/utils/mergeChanged';

// How often a visible list asks for the items changed since its newest one.
const CHANGED_SINCE_MS = 60_000;
// How often, at most, a visible list is reloaded in full. A changed-since query never
// returns an item someone else deleted or moved out of the list, so a full reload
// clears those within this period.
const FULL_REFETCH_MS = 5 * 60_000;

interface ChangedSinceOptions<T> {
  queryKey: QueryKey;
  // The whole list.
  fetchAll: () => Promise<T[]>;
  // The items of the list whose `updatedAt` is later than `since` (an ISO time).
  fetchChanged: (since: string) => Promise<T[]>;
  getUpdatedAt: (node: T) => string;
  enabled?: boolean;
}

// A list kept fresh the way Linear clients do without a sync engine: every minute
// while the tab is visible it asks only for the items changed since the newest one it
// has and merges them in; every five minutes, and on returning to the tab after five
// minutes away, it reloads the whole list. Both are skipped while a mutation is in
// flight, so neither can overwrite an optimistic update. After the viewer's own
// create, delete or move, call `refetchInFull` for the list's key.
export function useChangedSince<T extends { id: string }>(opts: ChangedSinceOptions<T>) {
  const { queryKey, fetchAll, fetchChanged, getUpdatedAt, enabled = true } = opts;
  const qc = useQueryClient();
  const lastFull = useRef(0);
  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const nodes = await fetchAll();
      lastFull.current = Date.now();
      return nodes;
    },
    enabled,
  });

  // The latest callbacks, so the interval below does not restart on every render.
  const latest = useRef({ fetchChanged, getUpdatedAt });
  latest.current = { fetchChanged, getUpdatedAt };
  const keyText = JSON.stringify(queryKey);

  useEffect(() => {
    if (!enabled) return;
    const key = JSON.parse(keyText) as QueryKey;
    const busy = () => document.visibilityState !== 'visible' || qc.isMutating() > 0;

    const tick = async () => {
      if (busy()) return;
      if (Date.now() - lastFull.current >= FULL_REFETCH_MS) {
        await qc.invalidateQueries({ queryKey: key, exact: true });
        return;
      }
      const current = qc.getQueryData<T[]>(key);
      if (!current) return;
      const since = newestUpdatedAt(current, latest.current.getUpdatedAt);
      if (!since) return;
      const changed = await latest.current.fetchChanged(since).catch(() => null);
      if (!changed || busy()) return;
      qc.setQueryData<T[]>(key, (list) => (list ? mergeChanged(list, changed) : list));
    };

    const id = window.setInterval(() => void tick(), CHANGED_SINCE_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [qc, keyText, enabled]);

  return query;
}

// Reloads a changed-since list in full; call it after the viewer's own create, delete
// or move, which a changed-since query would not reflect.
export function refetchInFull(qc: QueryClient, queryKey: QueryKey): Promise<void> {
  return qc.invalidateQueries({ queryKey, exact: true });
}

function newestUpdatedAt<T>(nodes: T[], getUpdatedAt: (node: T) => string): string | null {
  let newest: string | null = null;
  for (const node of nodes) {
    const at = getUpdatedAt(node);
    if (!newest || at > newest) newest = at;
  }
  return newest;
}
