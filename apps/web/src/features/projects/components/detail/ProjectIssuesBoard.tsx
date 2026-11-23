'use client';

import { useMemo } from 'react';
import { useShell } from '@/context/shellContext';
import { useLocalBoardSettings } from '@/hooks/useLocalBoardSettings';
import { applyFilters } from '@/utils/filters';
import { cyclesVisible } from '@/utils/cycles';
import FilterBar from '@/components/layout/FilterBar';
import DisplayPopover from '@/components/layout/DisplayPopover';
import KanbanBoard from '@/features/work-items/components/kanban/KanbanBoard';
import TableView from '@/features/work-items/components/table/TableView';
import TimelineView from '@/features/work-items/components/timeline/TimelineView';
import CalendarView from '@/features/work-items/components/calendar/CalendarView';

// The project's issues rendered as the work items board (kanban/table/timeline/
// calendar) with filters and display settings, but no saved views. The board is
// fed a team whose issues are just this project's, so drag/edit still hit the
// real issues and the live board refresh keeps it current.
export default function ProjectIssuesBoard({ projectId }: { projectId: string }) {
  const { team, onOpenIssue, onAddIssue } = useShell();
  const board = useLocalBoardSettings('planner_project_board_settings', projectId);

  const viewTeam = useMemo(() => {
    if (!team) return null;
    const issues = team.issues.filter((i) => i.project?.id === projectId);
    return { ...team, issues: applyFilters(issues, board.filters, team) };
  }, [team, projectId, board.filters]);

  if (!team || !viewTeam) return null;

  const viewProps = {
    team: viewTeam,
    settings: board.settings,
    onSettingsChange: board.changeSettings,
    onOpenIssue,
    onAddIssue: (defaults: Parameters<typeof onAddIssue>[0]) =>
      onAddIssue({ projectId, ...defaults }),
  };

  let view;
  switch (board.view) {
    case 'table':
      view = <TableView {...viewProps} />;
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
        <DisplayPopover
          view={board.view}
          onViewChange={board.changeView}
          settings={board.settings}
          onSettingsChange={board.changeSettings}
          cyclesOn={cyclesVisible(team)}
        />
      </div>
      <div className="relative flex-1 overflow-hidden">{view}</div>
    </div>
  );
}
