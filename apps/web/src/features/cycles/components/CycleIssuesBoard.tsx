'use client';

import { useMemo } from 'react';
import { useShell } from '@/context/shellContext';
import { useListBoardSettings } from '@/hooks/useListBoardSettings';
import { PreferencesError } from '@/components/common/page/PreferencesError';
import { applyFilters } from '@/utils/filters';
import { closedStateIds, visibleIssues } from '@/utils/completedIssues';
import FilterBar from '@/components/layout/FilterBar';
import DisplayPopover from '@/components/layout/DisplayPopover';
import KanbanBoard from '@/components/common/board/kanban/KanbanBoard';
import ListView from '@/components/common/board/list/ListView';
import TimelineView from '@/components/common/board/timeline/TimelineView';
import CalendarView from '@/components/common/board/calendar/CalendarView';
import InsightsButton from '@/features/insights/components/InsightsButton';
import InsightsPanel from '@/features/insights/components/InsightsPanel';
import { useInsightsSettings } from '@/features/insights/hooks/useInsightsSettings';
import { insightsViewKey } from '@/features/insights/utils/settings';
import { contextFromTeam, EMPTY_CONTEXT } from '@/features/insights/utils/context';
import { insightsScope, withSliceFilter } from '@/features/insights/utils/panel';
import { cycleIssues } from '../utils/cyclePage';

// The cycle's active issues as the work items board, with filters and display
// settings but no saved views. The board is fed the team's board issues narrowed to
// this cycle, so drags and edits patch the real issues and an issue moved to another
// cycle leaves this board at once.
export default function CycleIssuesBoard({
  cycleId,
  canAdd,
}: {
  cycleId: string;
  canAdd: boolean;
}) {
  const { team, onOpenIssue, onAddIssue } = useShell();
  const board = useListBoardSettings('cycle');

  const viewTeam = useMemo(() => {
    if (!team) return null;
    return {
      ...team,
      issues: applyFilters(
        visibleIssues(
          cycleIssues(team.issues, cycleId),
          board.settings,
          new Date(),
          closedStateIds(team.states),
        ),
        board.filters,
        team,
      ),
    };
  }, [team, cycleId, board.filters, board.settings]);

  const insightsKey = insightsViewKey({ kind: 'cycle', cycleId });
  const insights = useInsightsSettings(insightsKey);
  const insightsContext = useMemo(() => (team ? contextFromTeam(team) : EMPTY_CONTEXT), [team]);

  // Rendered once the stored display is loaded, so the list does not first show the
  // defaults.
  if (board.error) return <PreferencesError message={board.error} onRetry={board.retry} />;
  if (!team || !viewTeam || !board.ready) return null;

  const viewProps = {
    team: viewTeam,
    settings: board.settings,
    onSettingsChange: board.changeSettings,
    onOpenIssue,
    onPeekIssue: (id: string) => onOpenIssue(id, 'panel'),
    // Like Linear, issues are added only to the current and upcoming cycles.
    onAddIssue: canAdd
      ? (defaults: Parameters<typeof onAddIssue>[0]) => onAddIssue({ cycleId, ...defaults })
      : undefined,
  };

  let view;
  switch (board.view) {
    case 'list':
      view = <ListView {...viewProps} />;
      break;
    case 'timeline':
      view = <TimelineView {...viewProps} />;
      break;
    case 'calendar':
      view = <CalendarView {...viewProps} />;
      break;
    default:
      view = <KanbanBoard {...viewProps} />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <FilterBar filters={board.filters} onChange={board.setFilters} team={team} />
        <div className="flex items-center gap-1">
          <InsightsButton
            open={insights.settings.open}
            onToggle={() => insights.update({ open: !insights.settings.open })}
          />
          <DisplayPopover
            view={board.view}
            onViewChange={board.changeView}
            settings={board.settings}
            onSettingsChange={board.changeSettings}
            cyclesOn
          />
        </div>
      </div>
      <div className="relative flex-1 overflow-hidden">{view}</div>
      {insights.settings.open && (
        <InsightsPanel
          viewKey={insightsKey}
          settings={insights.settings}
          onChange={insights.update}
          scope={insightsScope({ cycle: { id: { eq: cycleId } } }, board.filters)}
          viewIssues={viewTeam.issues}
          baseContext={insightsContext}
          showSubIssues={board.settings.showSubIssues}
          onSliceFilter={(c) => board.setFilters(withSliceFilter(board.filters, c))}
          onOpenIssue={onOpenIssue}
        />
      )}
    </div>
  );
}
