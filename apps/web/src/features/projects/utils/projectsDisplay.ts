import type { TimelineScale } from '@/utils/viewSettings';
import {
  zoomFromPreference,
  zoomToPreference,
  type ViewPreferenceValues,
} from '@/utils/viewPreferences';
import { PROJECT_GROUPINGS, type ProjectGrouping } from './projectTimeline';

// The projects list's display, kept per person as Linear's `projects` view
// preferences: `projectLayout` (list or timeline), `projectGrouping` and
// `timelineZoomScale` (the timelines' 1, 2 and 3 for week, month and quarter).

export type ProjectsLayout = 'table' | 'timeline';

export interface ProjectsDisplay {
  layout: ProjectsLayout;
  grouping: ProjectGrouping;
  zoom: TimelineScale;
}

export function displayFromPreferences(
  prefs: ViewPreferenceValues | null | undefined,
): ProjectsDisplay {
  const grouping = PROJECT_GROUPINGS.find((g) => g.value === prefs?.projectGrouping)?.value;
  const zoom = zoomFromPreference(prefs?.timelineZoomScale);
  return {
    layout: prefs?.projectLayout === 'timeline' ? 'timeline' : 'table',
    grouping: grouping ?? 'none',
    zoom: zoom ?? 'month',
  };
}

export function preferencesFromDisplay(d: ProjectsDisplay): ViewPreferenceValues {
  return {
    projectLayout: d.layout === 'timeline' ? 'timeline' : 'list',
    projectGrouping: d.grouping,
    timelineZoomScale: zoomToPreference(d.zoom),
  };
}
