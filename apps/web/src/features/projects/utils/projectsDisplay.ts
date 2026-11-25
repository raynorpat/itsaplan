import type { TimelineScale } from '@/utils/viewSettings';
import type { ViewPreferenceValues } from '@/utils/viewPreferences';
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

const ZOOMS: TimelineScale[] = ['week', 'month', 'quarter'];

export function displayFromPreferences(
  prefs: ViewPreferenceValues | null | undefined,
): ProjectsDisplay {
  const grouping = PROJECT_GROUPINGS.find((g) => g.value === prefs?.projectGrouping)?.value;
  const zoom = prefs?.timelineZoomScale ? ZOOMS[prefs.timelineZoomScale - 1] : undefined;
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
    timelineZoomScale: ZOOMS.indexOf(d.zoom) + 1,
  };
}
