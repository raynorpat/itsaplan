import type { SliceField } from './slices';

// The Insights panel's settings for one view, kept in this browser per view. Linear's
// view preferences accept an `insights` value but no query returns it, so the settings
// do not follow the user to other devices.

export type Measure = 'count' | 'points' | 'cycleTime' | 'leadTime' | 'age';
export type PeriodMonths = 1 | 3 | 6 | 12;
export type InsightsTab = 'breakdown' | 'overTime';

export interface InsightsSettings {
  open: boolean;
  measure: Measure;
  slice: SliceField;
  segment: SliceField | null;
  periodMonths: PeriodMonths;
  tab: InsightsTab;
}

export const DEFAULT_INSIGHTS_SETTINGS: InsightsSettings = {
  open: false,
  measure: 'count',
  slice: 'status',
  segment: null,
  periodMonths: 3,
  tab: 'breakdown',
};

export const MEASURES: Measure[] = ['count', 'points', 'cycleTime', 'leadTime', 'age'];
export const SLICE_FIELDS: SliceField[] = [
  'status',
  'assignee',
  'priority',
  'label',
  'project',
  'cycle',
  'creator',
  'team',
];
export const PERIODS: PeriodMonths[] = [1, 3, 6, 12];

const TABS: InsightsTab[] = ['breakdown', 'overTime'];

function oneOf<T>(list: readonly T[], value: unknown): value is T {
  return list.includes(value as T);
}

// Reads stored settings, keeping each recognised value and using the default for
// anything missing or unknown (an older or hand-edited entry never breaks the panel).
export function parseInsightsSettings(raw: string | null): InsightsSettings {
  if (raw == null) return DEFAULT_INSIGHTS_SETTINGS;
  let stored: unknown;
  try {
    stored = JSON.parse(raw);
  } catch {
    return DEFAULT_INSIGHTS_SETTINGS;
  }
  if (typeof stored !== 'object' || stored === null) return DEFAULT_INSIGHTS_SETTINGS;
  const s = stored as Record<string, unknown>;
  const d = DEFAULT_INSIGHTS_SETTINGS;
  return {
    open: typeof s.open === 'boolean' ? s.open : d.open,
    measure: oneOf(MEASURES, s.measure) ? s.measure : d.measure,
    slice: oneOf(SLICE_FIELDS, s.slice) ? s.slice : d.slice,
    segment: oneOf(SLICE_FIELDS, s.segment) ? s.segment : d.segment,
    periodMonths: oneOf(PERIODS, s.periodMonths) ? s.periodMonths : d.periodMonths,
    tab: oneOf(TABS, s.tab) ? s.tab : d.tab,
  };
}

export type InsightsView =
  | { kind: 'allIssues'; teamId: string }
  | { kind: 'project'; projectId: string }
  | { kind: 'cycle'; cycleId: string }
  | { kind: 'myIssues' }
  | { kind: 'view'; viewId: string }
  // A view being created, before it has an id.
  | { kind: 'newView'; teamId: string };

// The key a view's settings are stored under: the list kind and its team, project or
// cycle, or the saved view's id.
export function insightsViewKey(view: InsightsView): string {
  switch (view.kind) {
    case 'allIssues':
      return `allIssues:${view.teamId}`;
    case 'project':
      return `project:${view.projectId}`;
    case 'cycle':
      return `cycle:${view.cycleId}`;
    case 'myIssues':
      return 'myIssues';
    case 'view':
      return `view:${view.viewId}`;
    case 'newView':
      return `newView:${view.teamId}`;
  }
}

// The storage key of one user's settings for a view, so people sharing a browser keep
// their own.
export function insightsStorageKey(userId: string, viewKey: string): string {
  return `${STORAGE_PREFIX}${userId}.${viewKey}`;
}

// The settings a view shows: those held for it, else its stored ones. Held settings
// belong to the view they were read for, so a change made right after switching
// views is applied to the new view's settings, never the previous view's.
export function settingsForKey(
  held: { key: string | null; settings: InsightsSettings },
  viewKey: string,
  read: (viewKey: string) => InsightsSettings,
): InsightsSettings {
  return held.key === viewKey ? held.settings : read(viewKey);
}

const STORAGE_PREFIX = 'itsaplan.insights.';

export function readInsightsSettings(userId: string | null, viewKey: string): InsightsSettings {
  if (typeof window === 'undefined' || userId == null) return DEFAULT_INSIGHTS_SETTINGS;
  try {
    return parseInsightsSettings(window.localStorage.getItem(insightsStorageKey(userId, viewKey)));
  } catch {
    return DEFAULT_INSIGHTS_SETTINGS;
  }
}

export function writeInsightsSettings(
  userId: string | null,
  viewKey: string,
  settings: InsightsSettings,
): void {
  if (typeof window === 'undefined' || userId == null) return;
  try {
    window.localStorage.setItem(insightsStorageKey(userId, viewKey), JSON.stringify(settings));
  } catch {
    // Storage may be unavailable (private mode); the settings then last for the page.
  }
}
