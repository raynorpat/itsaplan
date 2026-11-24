'use client';

import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import type { FilterCondition } from '@/utils/filters';
import type { IssueFilter } from '@/utils/viewFilters';
import { useViewerWorkspaceQuery } from '@/services/viewer.service';
import { useInsightsData } from '../hooks/useInsightsData';
import { INSIGHTS_ISSUE_LIMIT } from '../services/insightsIssues.service';
import { breakdown, isTimeMeasure } from '../utils/measures';
import { timeRows } from '../utils/stats';
import { weeklyCreatedCompleted } from '../utils/overTime';
import { effectiveSettings, MEASURE_LABELS, measureOptions, sliceOptions } from '../utils/panel';
import type { InsightsSettings } from '../utils/settings';
import type { InsightIssue, InsightsContext } from '../utils/slices';
import InsightsControls from './InsightsControls';
import BreakdownChart from './BreakdownChart';
import TimeChart from './TimeChart';
import OverTimeChart from './OverTimeChart';

// Linear's Insights panel below a view's list or board. It is mounted only while open,
// so a closed panel fetches nothing. The figures are computed here, in the browser,
// from the view's issues and the issues completed in the period.
export default function InsightsPanel({
  viewKey,
  settings,
  onChange,
  scope,
  viewIssues,
  baseContext,
  showSubIssues,
  spansTeams = false,
  fetchOpen = false,
  onSliceFilter,
  onOpenIssue,
}: {
  viewKey: string;
  settings: InsightsSettings;
  onChange: (patch: Partial<InsightsSettings>) => void;
  scope: IssueFilter;
  viewIssues: InsightIssue[];
  baseContext: InsightsContext;
  // The view's "Show sub-issues" display setting, applied to the fetched issues too.
  showSubIssues: boolean;
  spansTeams?: boolean;
  fetchOpen?: boolean;
  // Narrows the view to a clicked slice; omitted where the view has no filter.
  onSliceFilter?: (condition: FilterCondition) => void;
  onOpenIssue: (issueId: string) => void;
}) {
  const workspaceRole = useViewerWorkspaceQuery().data?.workspaceRole;
  const data = useInsightsData({
    enabled: true,
    readsRequests: workspaceRole != null && workspaceRole !== 'guest',
    viewKey,
    scope,
    viewIssues,
    baseContext,
    periodMonths: settings.periodMonths,
    showSubIssues,
    fetchOpen,
  });
  const hasEstimates = data.issues.some((i) => (i.estimate ?? 0) > 0);
  const hasRequests = data.issues.some((i) => i.requests != null);
  const shown = effectiveSettings(settings, { hasEstimates, hasRequests, spansTeams });
  const measureLabel = MEASURE_LABELS[shown.measure];

  const content = useMemo(() => {
    if (shown.tab === 'overTime')
      return (
        <OverTimeChart
          weeks={weeklyCreatedCompleted(data.issues, shown.periodMonths, new Date())}
        />
      );
    if (isTimeMeasure(shown.measure))
      return (
        <TimeChart
          result={timeRows(data.issues, shown.measure, shown.slice, data.context)}
          slice={shown.slice}
          states={data.context.states}
          measureLabel={measureLabel}
          onSliceFilter={onSliceFilter}
          onOpenIssue={onOpenIssue}
        />
      );
    return (
      <BreakdownChart
        rows={breakdown(data.issues, shown, data.context)}
        slice={shown.slice}
        segment={shown.segment}
        states={data.context.states}
        unit={measureLabel}
        onSliceFilter={onSliceFilter}
      />
    );
  }, [shown, data.issues, data.context, measureLabel, onSliceFilter, onOpenIssue]);

  return (
    <section
      aria-label="Insights"
      className="flex max-h-[45%] min-h-56 shrink-0 flex-col border-t bg-background"
    >
      <InsightsControls
        settings={shown}
        measures={measureOptions({ hasEstimates, hasRequests })}
        fields={sliceOptions({ spansTeams })}
        onChange={onChange}
        onClose={() => onChange({ open: false })}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {data.error ? (
          <div className="flex items-center gap-3 p-4 text-sm text-muted-foreground">
            The insights did not load.
            <Button variant="outline" size="sm" onClick={data.retry}>
              Retry
            </Button>
          </div>
        ) : data.loading ? (
          <p className="p-4 text-sm text-muted-foreground" aria-live="polite">
            Loading insights…
          </p>
        ) : (
          <>
            {content}
            {data.capped && (
              <p className="px-3 pb-3 text-xs text-muted-foreground">
                Showing the first {INSIGHTS_ISSUE_LIMIT.toLocaleString('en-US')} issues.
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
