import { useCallback, useMemo, useState } from 'react';
import type { WorkItemsView } from '@/utils/viewTypes';
import type { ViewSettings } from '@/utils/viewSettings';
import { switchLayout } from '@/utils/listPreferences';
import { EMPTY_FILTER_SET, type FilterSet } from '@/utils/filters';
import { useListPreferences } from './useListPreferences';

// Display settings for an issue board without saved views (a project's or a
// cycle's issues): the viewer's display for that list kind, on the server and shared
// by every project (or every cycle). Filters stay transient in state.
export function useListBoardSettings(viewType: 'project' | 'cycle') {
  const prefs = useListPreferences(viewType);
  const [filters, setFilters] = useState<FilterSet>(EMPTY_FILTER_SET);

  const { view, settings } = useMemo(() => {
    const { layout, ...rest } = prefs.display;
    return { view: layout, settings: rest as ViewSettings };
  }, [prefs.display]);

  const { update } = prefs;
  const changeView = useCallback(
    (next: WorkItemsView) => update({ layout: next, ...switchLayout(settings, view, next) }),
    [update, settings, view],
  );
  const changeSettings = useCallback(
    (next: ViewSettings) => update({ layout: view, ...next }),
    [update, view],
  );

  return { view, settings, changeView, changeSettings, filters, setFilters, ready: prefs.ready };
}
