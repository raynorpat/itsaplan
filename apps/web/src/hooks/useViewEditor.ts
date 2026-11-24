import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { View } from '@/types/team';
import type { WorkItemsView } from '@/utils/viewTypes';
import { qk } from '@/services/queryKeys';
import {
  saveViewCollapse,
  useCreateView,
  useDeleteView,
  useUpdateView,
} from '@/services/views.service';
import { createPreferenceSync, type PreferenceSync } from '@/utils/listPreferences';
import { collapseChanged, withCollapse } from '@/utils/viewPreferences';
import { EMPTY_FILTER_SET, isActiveFilterSet, type FilterSet } from '@/utils/filters';
import {
  defaultViewSettings,
  type SavedViewDisplay,
  type ViewSettings,
} from '@/utils/viewSettings';
import { useListPreferences } from './useListPreferences';

// The conditions of a saved view followed by the ad-hoc ones, re-keyed so the two
// sources cannot collide on a condition id.
function mergeFilters(base: FilterSet | null | undefined, extra: FilterSet): FilterSet {
  return {
    conditions: [...(base?.conditions ?? []), ...extra.conditions].map((c, i) => ({
      ...c,
      id: `c${i}`,
    })),
  };
}

// A saved view's display snapshot is the current layout plus that layout's
// settings.
function toDisplay(view: WorkItemsView, settings: ViewSettings): SavedViewDisplay {
  return { layout: view, ...settings };
}

function splitDisplay({ layout, ...rest }: SavedViewDisplay) {
  return { view: layout, settings: rest as ViewSettings };
}

type CollapseSave = { viewId: string; display: SavedViewDisplay };

// Sends the viewer's collapse on a saved view, one save in flight at a time.
function useViewCollapseSync(teamKey: string | null) {
  const qc = useQueryClient();
  const sync = useRef<PreferenceSync<CollapseSave> | null>(null);
  const viewOfPending = useRef<string | null>(null);
  if (sync.current == null) {
    sync.current = createPreferenceSync<CollapseSave>({
      save: ({ viewId, display }) => saveViewCollapse(viewId, display),
      delayMs: 300,
      onSaved: () => {
        if (teamKey) void qc.invalidateQueries({ queryKey: qk.views(teamKey) });
      },
      onFailed: (err) =>
        toast.error(err instanceof Error ? err.message : 'The collapsed groups were not saved'),
    });
  }
  useEffect(() => () => sync.current?.flush(), []);
  return (viewId: string, display: SavedViewDisplay) => {
    // A pending save for another view goes out first rather than being replaced.
    if (viewOfPending.current !== viewId) sync.current?.flush();
    viewOfPending.current = viewId;
    sync.current?.push({ viewId, display });
  };
}

// The saved-views and display/filter editing for one team. The active view is
// controlled: it comes from the caller (the route param) and selecting a view
// calls onSelectView to navigate. This hook owns the live layout, its display
// settings, the live filter set and the inline edit-bar state, and loads the
// selection's display whenever the active view (or team) changes.
//
// Filters and display settings are live, transient state: changing them filters
// the current screen and never writes to a saved view. On the All tab (not editing)
// the layout and its settings are the viewer's All issues display, saved on the
// server and shared by every team. On a saved view the viewer's collapsed groups and
// swimlanes are saved as their own preferences for it. A view is
// written only from the edit bar, which is opened explicitly by Edit view (update
// the active view) or New view (create one from the live state).
//
// `filters` holds only the ad-hoc conditions. A saved view's own conditions are
// not shown in the filter row: they are part of the view and are merged in behind
// it (see effectiveFilters). Edit view folds them into `filters` so they can be
// changed, and Save writes that set back to the view.
export function useViewEditor(
  teamKey: string | null,
  views: View[],
  activeViewId: string | null,
  onSelectView: (id: string | null) => void,
) {
  const allIssues = useListPreferences('allIssues');
  const saveCollapse = useViewCollapseSync(teamKey);
  // The live display of a saved view or a draft; the All tab outside a draft shows
  // the viewer's All issues display instead (onAll below).
  const [liveView, setView] = useState<WorkItemsView>('list');
  const [liveSettings, setSettings] = useState<ViewSettings>(() => defaultViewSettings('list'));
  const [filters, setFilters] = useState<FilterSet>(EMPTY_FILTER_SET);
  // editing is true while the name/Cancel/Save bar is shown. draftName/draftIcon
  // back the name input and icon picker in the bar.
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftIcon, setDraftIcon] = useState<string | null>(null);
  // Whether the filter row is shown. It is also shown once the live filters differ
  // from the selection's own filters, so ad-hoc filters can never be hidden.
  const [filtersOpen, setFiltersOpen] = useState(false);

  const createView = useCreateView(teamKey);
  const updateView = useUpdateView(teamKey);
  const deleteViewMutation = useDeleteView(teamKey);

  const activeView =
    activeViewId != null ? (views.find((v) => v.id === activeViewId) ?? null) : null;

  const onAll = activeViewId == null && !editing;
  const allDisplay = useMemo(() => splitDisplay(allIssues.display), [allIssues.display]);
  const view = onAll ? allDisplay.view : liveView;
  const settings = onAll ? allDisplay.settings : liveSettings;

  // What actually filters the screen: the active view's own conditions plus the
  // ad-hoc ones. While editing, the row already holds the view's conditions.
  const effectiveFilters = useMemo(
    () => (editing ? filters : mergeFilters(activeView?.filters, filters)),
    [editing, filters, activeView],
  );

  function applyDisplay({ layout, ...rest }: SavedViewDisplay) {
    setView(layout);
    setSettings(rest);
  }

  // Load the live layout/settings for a selection and drop the ad-hoc filters: the
  // All tab shows the viewer's All issues display; a saved view uses its own stored
  // display. forEdit loads the view's own conditions into
  // the filter row, for the edit bar to change them.
  function loadSelection(id: string | null, forEdit = false) {
    if (id == null) {
      setFilters(EMPTY_FILTER_SET);
      applyDisplay(allIssues.display);
      return;
    }
    const v = views.find((x) => x.id === id);
    if (!v) return;
    setFilters(forEdit ? mergeFilters(v.filters, EMPTY_FILTER_SET) : EMPTY_FILTER_SET);
    applyDisplay(v.display);
  }

  // Apply the selection's display whenever the routed view or the team changes,
  // or once the selected view's data arrives. loadedRef keys on team+view so an
  // unrelated views refetch (e.g. after Save) does not clobber the live edit.
  // openEditNext lets beginNewView/beginEditView keep the edit bar open across the
  // navigation that changes the selection; keepLiveNext lets beginNewView carry the
  // live filters and display into the draft instead of reloading the selection.
  const loadedRef = useRef<string | null>(null);
  const openEditNext = useRef(false);
  const keepLiveNext = useRef(false);
  useEffect(() => {
    if (activeViewId != null && !views.some((v) => v.id === activeViewId)) return; // wait for views
    const key = `${teamKey}:${activeViewId}`;
    if (loadedRef.current === key) return;
    loadedRef.current = key;
    if (keepLiveNext.current) keepLiveNext.current = false;
    else loadSelection(activeViewId, openEditNext.current);
    setEditing(openEditNext.current);
    openEditNext.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamKey, activeViewId, views]);

  // Enters edit mode, seeding the name and icon inputs from the given view (or
  // blank for a new/All-tab draft).
  function beginEdit(from: View | null) {
    setEditing(true);
    setDraftName(from?.name ?? '');
    setDraftIcon(from?.icon ?? null);
  }

  // Enter edit mode for a new view, drafted from what is on screen: the active
  // view's conditions plus the ad-hoc ones, and the live display. Deselecting the
  // active view (navigating to the All tab) keeps that state, so saveEdits creates
  // (not updates).
  function beginNewView() {
    setFilters(mergeFilters(activeView?.filters, filters));
    // On the All tab the draft starts from the viewer's All issues display.
    if (activeViewId == null) applyDisplay(allIssues.display);
    if (activeViewId != null) {
      openEditNext.current = true;
      keepLiveNext.current = true;
      onSelectView(null);
    }
    beginEdit(null);
  }

  // One display serves every layout, as in Linear; Timeline and Calendar ignore the
  // options they do not use. On the All tab (not editing) it is the viewer's All
  // issues display; on a saved view or a draft the change is live until an explicit
  // Save, except a saved view's collapse, which is the viewer's own.
  function changeView(next: WorkItemsView) {
    if (onAll) allIssues.update({ ...settings, layout: next });
    else setView(next);
  }

  function changeSettings(next: ViewSettings) {
    if (onAll) {
      allIssues.update({ layout: view, ...next });
      return;
    }
    setSettings(next);
    if (activeViewId != null && !editing && collapseChanged(settings, next))
      saveCollapse(activeViewId, { layout: view, ...next });
  }

  function toggleFilters() {
    setFiltersOpen((open) => !open);
  }

  // Reset the live filters/display back to the selected view and leave edit mode.
  function cancelEdits() {
    setEditing(false);
    loadSelection(activeViewId);
  }

  // Update the current saved view (also applying any rename), or create a new
  // view from the draft when there is no active view and select it. The edited
  // conditions become the view's own, so the filter row is emptied: they now apply
  // through the view.
  async function saveEdits() {
    if (!teamKey) return;
    const name = draftName.trim();
    const display = toDisplay(view, settings);
    if (activeView) {
      // The view is saved for everyone with its shared collapse; the editor's own
      // stays their personal preference.
      const shared = withCollapse(display, activeView.sharedCollapse);
      await updateView.mutateAsync({
        id: activeView.id,
        input: { name: name || activeView.name, icon: draftIcon, filters, display: shared },
      });
      setFilters(EMPTY_FILTER_SET);
      setEditing(false);
    } else {
      if (!name) return; // Save is disabled without a name for a new view.
      const createdId = await createView.mutateAsync({
        input: { name, icon: draftIcon, filters, display },
      });
      setFilters(EMPTY_FILTER_SET);
      setEditing(false);
      onSelectView(createdId);
    }
  }

  // Edit from a tab's menu: select the view (keeping the edit bar open across the
  // navigation) and show its own conditions in the filter row, with any ad-hoc
  // ones folded in so Save keeps what is on screen.
  function beginEditView(target: View) {
    if (activeViewId !== target.id) {
      openEditNext.current = true;
      onSelectView(target.id); // the load effect fills the filter row for the edit
    } else {
      setFilters(mergeFilters(target.filters, filters));
    }
    beginEdit(target);
  }

  async function deleteView(target: View) {
    await deleteViewMutation.mutateAsync(target.id);
    if (activeViewId === target.id) onSelectView(null);
  }

  return {
    view,
    settings,
    // False on the All tab until the viewer's display is loaded, so the list does
    // not first render with the defaults; error is set when it failed to load.
    ready: activeViewId != null || allIssues.ready,
    error: activeViewId == null ? allIssues.error : null,
    retry: allIssues.retry,
    filters,
    effectiveFilters,
    // The filter row is open on request, while editing, or while an ad-hoc filter
    // applies, so an applied filter can never be hidden.
    showFilters: filtersOpen || editing || isActiveFilterSet(filters),
    activeViewId,
    activeView,
    editing,
    draftName,
    setDraftName,
    draftIcon,
    setDraftIcon,
    beginNewView,
    changeView,
    changeSettings,
    changeFilters: setFilters,
    toggleFilters,
    // Selecting a saved view (or the All tab when id is null) navigates; the load
    // effect then applies its display and leaves edit mode.
    selectView: onSelectView,
    cancelEdits,
    saveEdits,
    beginEditView,
    deleteView,
  };
}
