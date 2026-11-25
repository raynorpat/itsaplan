'use client';

import { useMemo } from 'react';
import { useShell } from '@/context/shellContext';
import { useListBoardSettings } from '@/hooks/useListBoardSettings';
import { PreferencesError } from '@/components/common/page/PreferencesError';
import { applyFilters } from '@/utils/filters';
import { closedStateIds, visibleIssues } from '@/utils/completedIssues';
import { cyclesVisible } from '@/utils/cycles';
import { cycleSafeSettings } from '@/utils/viewSettings';
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
import { contextFromTeam, EMPTY_CONTEXT } from '@/utils/insights/context';
import { insightsScope, withSliceFilter } from '@/features/insights/utils/panel';

// The project's issues rendered as the work items board (kanban/table/timeline/
// calendar) with filters and display settings, but no saved views. The board is
// fed a team whose issues are just this project's, so drag/edit still hit the
// real issues and the live board refresh keeps it current.
export default function ProjectIssuesBoard({ projectId }: { projectId: string }) {
  const { team, onOpenIssue, onAddIssue } = useShell();
  const board = useListBoardSettings('project');

  const viewTeam = useMemo(() => {
    if (!team) return null;
    const issues = team.issues.filter((i) => i.project?.id === projectId);
    const shown = visibleIssues(issues, board.settings, new Date(), closedStateIds(team.states));
    return { ...team, issues: applyFilters(shown, board.filters, team) };
  }, [team, projectId, board.filters, board.settings]);

  const insightsKey = insightsViewKey({ kind: 'project', projectId });
  const insights = useInsightsSettings(insightsKey);
  const insightsContext = useMemo(() => (team ? contextFromTeam(team) : EMPTY_CONTEXT), [team]);

  // Rendered once the stored display is loaded, so the list does not first show the
  // defaults.
  if (board.error) return <PreferencesError message={board.error} onRetry={board.retry} />;
  if (!team || !viewTeam || !board.ready) return null;
  const settings = cycleSafeSettings(board.settings, board.view, cyclesVisible(team));

  const viewProps = {
    team: viewTeam,
    settings,
    onSettingsChange: board.changeSettings,
    onOpenIssue,
    onPeekIssue: (id: string) => onOpenIssue(id, 'panel'),
    onAddIssue: (defaults: Parameters<typeof onAddIssue>[0]) =>
      onAddIssue({ projectId, ...defaults }),
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
            settings={settings}
            onSettingsChange={board.changeSettings}
            cyclesOn={cyclesVisible(team)}
            requestsOn={team.viewer.workspaceRole !== 'guest'}
          />
        </div>
      </div>
      <div className="relative flex-1 overflow-hidden">{view}</div>
      {insights.settings.open && (
        <InsightsPanel
          viewKey={insightsKey}
          settings={insights.settings}
          onChange={insights.update}
          // The board shows the project's issues of this team only.
          scope={insightsScope(
            {
              and: [{ project: { id: { eq: projectId } } }, { team: { id: { eq: team.team.id } } }],
            },
            board.filters,
          )}
          viewIssues={viewTeam.issues}
          baseContext={insightsContext}
          showSubIssues={settings.showSubIssues}
          onSliceFilter={(c) => board.setFilters(withSliceFilter(board.filters, c))}
          onOpenIssue={onOpenIssue}
        />
      )}
    </div>
  );
}
