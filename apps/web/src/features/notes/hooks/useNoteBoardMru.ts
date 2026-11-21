import { useCallback, useEffect, useState } from 'react';

// The recently-opened boards backing the tab strip. Kept per team in
// localStorage (per browser, not synced): a lightweight most-recently-used list so
// the tabs show the last few boards without loading every board. The cached name
// and visibility only label the tab; opening a board fetches its fresh state and
// re-records it, which self-heals a stale label.
export interface MruEntry {
  id: string;
  name: string;
  personal: boolean;
}

const MAX = 5;

function storageKey(teamKey: string) {
  return `noteBoards:mru:${teamKey}`;
}

function isEntry(v: unknown): v is MruEntry {
  return typeof v === 'object' && v !== null && typeof (v as MruEntry).id === 'string';
}

function read(teamKey: string): MruEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(storageKey(teamKey));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isEntry).slice(0, MAX) : [];
  } catch {
    return [];
  }
}

export function useNoteBoardMru(teamKey: string) {
  const [entries, setEntries] = useState<MruEntry[]>(() => read(teamKey));

  // Reload when switching teams — the hook instance may outlive the route.
  useEffect(() => setEntries(read(teamKey)), [teamKey]);

  const persist = useCallback(
    (next: MruEntry[]) => {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(storageKey(teamKey), JSON.stringify(next));
      }
      return next;
    },
    [teamKey],
  );

  // Record an opened board. A board already in the list keeps its tab position (its
  // label/visibility is refreshed in place, so re-opening it does not reshuffle the
  // tabs); a new board is added to the front, capped at MAX.
  const record = useCallback(
    (entry: MruEntry) =>
      setEntries((prev) => {
        const idx = prev.findIndex((e) => e.id === entry.id);
        if (idx !== -1) {
          const next = [...prev];
          next[idx] = entry;
          return persist(next);
        }
        return persist([entry, ...prev].slice(0, MAX));
      }),
    [persist],
  );

  const remove = useCallback(
    (id: string) => setEntries((prev) => persist(prev.filter((e) => e.id !== id))),
    [persist],
  );

  return { entries, record, remove };
}
