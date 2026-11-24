import {
  displayToPreferences,
  preferencesToDisplay,
  type ViewPreferenceValues,
} from './viewPreferences';
import { defaultViewSettings, type SavedViewDisplay, type ViewSettings } from './viewSettings';
import type { WorkItemsView } from './viewTypes';

// The list kinds whose display is one personal record per user on the server
// (Linear's view types). A setting applies to every list of its kind: every team's
// All issues, every project's issues, every cycle, My issues.
export type ListViewType = 'allIssues' | 'project' | 'cycle' | 'myIssues';

// A stored record (Linear's view preference names) as the display a list uses; null
// (never changed) and missing or unknown keys read as Linear's defaults.
export function toDisplay(stored: ViewPreferenceValues | null | undefined): SavedViewDisplay {
  return preferencesToDisplay(stored);
}

// The display as the record saved on the server. The week start is a browser
// preference and is not part of it.
export function toStored(display: SavedViewDisplay): ViewPreferenceValues {
  return displayToPreferences(display);
}

const SHARED: WorkItemsView[] = ['list', 'kanban'];

// The settings after switching layout. List and Board share every setting, as in
// Linear; Timeline and Calendar lay issues out by date, so switching to or from them
// starts from the new layout's defaults and keeps only which completed issues and
// sub-issues show.
export function switchLayout(
  settings: ViewSettings,
  from: WorkItemsView,
  to: WorkItemsView,
): ViewSettings {
  if (SHARED.includes(from) && SHARED.includes(to)) return settings;
  return {
    ...defaultViewSettings(to),
    completedIssues: settings.completedIssues,
    showSubIssues: settings.showSubIssues,
    weekStart: settings.weekStart,
  };
}

export interface DebouncedSaver<T> {
  // Replaces the pending value and restarts the wait.
  push: (value: T) => void;
  // Sends the pending value now, if any.
  flush: () => void;
}

// Coalesces quick successive changes into one save of the latest value, sent after
// `delayMs` without a further change, or at once on flush (the list is left).
export function createDebouncedSaver<T>(
  save: (value: T) => void,
  delayMs: number,
  timers: { set: (fn: () => void, ms: number) => unknown; clear: (handle: unknown) => void } = {
    set: (fn, ms) => setTimeout(fn, ms),
    clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  },
): DebouncedSaver<T> {
  let pending: { value: T } | null = null;
  let handle: unknown = null;
  const flush = () => {
    if (handle != null) timers.clear(handle);
    handle = null;
    if (!pending) return;
    const { value } = pending;
    pending = null;
    save(value);
  };
  return {
    push(value) {
      pending = { value };
      if (handle != null) timers.clear(handle);
      handle = timers.set(flush, delayMs);
    },
    flush,
  };
}
