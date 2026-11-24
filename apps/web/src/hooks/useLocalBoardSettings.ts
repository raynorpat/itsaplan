import { useCallback, useState } from 'react';
import { toLayout, type WorkItemsView } from '@/utils/viewTypes';
import { normalizeViewSettings, type ViewSettings } from '@/utils/viewSettings';
import { EMPTY_FILTER_SET, type FilterSet } from '@/utils/filters';

// Display settings for an issue board without saved views (a project's or a
// cycle's issues), persisted in localStorage under `storeKey`, one entry per `id`.
// Filters stay transient in state. Layout (list/board) and its display settings
// are stored together so a reload restores them.

type Stored = { layout?: WorkItemsView } & Partial<ViewSettings>;
type Store = Record<string, Stored>;

function readStore(storeKey: string): Store {
  if (typeof window === 'undefined') return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(storeKey) ?? 'null');
    return parsed && typeof parsed === 'object' ? (parsed as Store) : {};
  } catch {
    return {};
  }
}

function writeStore(storeKey: string, store: Store) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(storeKey, JSON.stringify(store));
}

export function useLocalBoardSettings(storeKey: string, id: string) {
  const [state, setState] = useState<{ view: WorkItemsView; settings: ViewSettings }>(() => {
    const stored = readStore(storeKey)[id];
    const view: WorkItemsView = toLayout(stored?.layout) ?? 'list';
    return { view, settings: normalizeViewSettings(stored, view) };
  });
  const [filters, setFilters] = useState<FilterSet>(EMPTY_FILTER_SET);

  const persist = useCallback(
    (view: WorkItemsView, settings: ViewSettings) => {
      const store = readStore(storeKey);
      store[id] = { layout: view, ...settings };
      writeStore(storeKey, store);
    },
    [storeKey, id],
  );

  const changeView = useCallback(
    (view: WorkItemsView) => {
      const settings = normalizeViewSettings(readStore(storeKey)[id], view);
      persist(view, settings);
      setState({ view, settings });
    },
    [storeKey, id, persist],
  );

  const changeSettings = useCallback(
    (settings: ViewSettings) => {
      setState((prev) => {
        persist(prev.view, settings);
        return { ...prev, settings };
      });
    },
    [persist],
  );

  return {
    view: state.view,
    settings: state.settings,
    changeView,
    changeSettings,
    filters,
    setFilters,
  };
}
