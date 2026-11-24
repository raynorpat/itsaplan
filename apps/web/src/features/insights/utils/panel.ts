import { filterSetToIssueFilter, type IssueFilter } from '@/utils/viewFilters';
import type { FilterCondition, FilterSet } from '@/utils/filters';
import {
  DEFAULT_INSIGHTS_SETTINGS,
  MEASURES,
  SLICE_FIELDS,
  type InsightsSettings,
  type Measure,
  type PeriodMonths,
} from './settings';
import type { SliceField } from './slices';

export const MEASURE_LABELS: Record<Measure, string> = {
  count: 'Issue count',
  points: 'Estimate points',
  requests: 'Requests',
  requesters: 'Requesters',
  cycleTime: 'Cycle time',
  leadTime: 'Lead time',
  age: 'Issue age',
};

export const SLICE_LABELS: Record<SliceField, string> = {
  status: 'Status',
  assignee: 'Assignee',
  priority: 'Priority',
  label: 'Label',
  project: 'Project',
  cycle: 'Cycle',
  creator: 'Creator',
  team: 'Team',
};

export const PERIOD_LABELS: Record<PeriodMonths, string> = {
  1: 'Last month',
  3: 'Last 3 months',
  6: 'Last 6 months',
  12: 'Last 12 months',
};

// A duration in days as the panel shows it: hours under a day, one decimal under ten
// days, whole days above.
export function formatDays(days: number): string {
  if (days > 0 && days < 1) {
    const hours = Math.round(days * 24);
    return hours < 1 ? '<1 h' : `${hours} h`;
  }
  if (days < 10) return `${Math.round(days * 10) / 10} d`;
  return `${Math.round(days)} d`;
}

// The measures a view offers: points only when its issues have estimates; requests
// and requesters only when its issues carry their feedback (members, not guests).
export function measureOptions({
  hasEstimates,
  hasRequests,
}: {
  hasEstimates: boolean;
  hasRequests: boolean;
}): Measure[] {
  return MEASURES.filter(
    (m) =>
      (m !== 'points' || hasEstimates) && ((m !== 'requests' && m !== 'requesters') || hasRequests),
  );
}

// The fields a view slices by: team only where the view spans teams.
export function sliceOptions({ spansTeams }: { spansTeams: boolean }): SliceField[] {
  return SLICE_FIELDS.filter((f) => f !== 'team' || spansTeams);
}

// The stored settings as this view can use them: a measure or field the view does
// not offer falls back to the default, and a segment equal to the slice is dropped.
export function effectiveSettings(
  settings: InsightsSettings,
  opts: { hasEstimates: boolean; hasRequests: boolean; spansTeams: boolean },
): InsightsSettings {
  const measures = measureOptions(opts);
  const fields = sliceOptions(opts);
  const measure = measures.includes(settings.measure)
    ? settings.measure
    : DEFAULT_INSIGHTS_SETTINGS.measure;
  const slice = fields.includes(settings.slice) ? settings.slice : DEFAULT_INSIGHTS_SETTINGS.slice;
  const segment =
    settings.segment && fields.includes(settings.segment) && settings.segment !== slice
      ? settings.segment
      : null;
  return { ...settings, measure, slice, segment };
}

// Linear's IssueFilter for a view's insights: its scope (team, project, cycle or the
// viewer) and its filter conditions.
export function insightsScope(base: IssueFilter, filters: FilterSet | null): IssueFilter {
  const own = filterSetToIssueFilter(filters);
  return Object.keys(own).length ? { and: [base, own] } : base;
}

// The view's filter narrowed to a clicked slice: the condition is added, replacing an
// earlier slice condition on the same field.
export function withSliceFilter(filters: FilterSet, condition: FilterCondition): FilterSet {
  return {
    conditions: [...filters.conditions.filter((c) => c.id !== condition.id), condition],
  };
}
