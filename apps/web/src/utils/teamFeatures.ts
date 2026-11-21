import type { TeamFeatures } from '@/lib/api';

// What each optional section is called in the navigation. Shared by the switches
// that turn a section off, their confirmation, and the notice the section shows
// while it is off, so it is named the same everywhere.
export const FEATURE_LABEL: Record<keyof TeamFeatures, string> = {
  projects: 'Projects',
  dashboards: 'Dashboards',
  notes: 'Notes',
};
