'use client';

import { useMemo, useState } from 'react';
import { PreferencesError } from '@/components/common/page/PreferencesError';
import { useShell } from '@/context/shellContext';
import { usePermissions } from '@/hooks/usePermissions';
import { buildGroups, groupIssues } from '@/utils/team';
import { cyclesVisible } from '@/utils/cycles';
import { cycleSafeSettings, type ViewSettings } from '@/utils/viewSettings';
import { closedStateIds, visibleIssues } from '@/utils/completedIssues';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import ViewTabs from '@/components/layout/ViewTabs';
import PageHeaderPortal from '@/components/layout/PageHeaderPortal';
import ViewIconPicker from '@/components/layout/ViewIconPicker';
import FilterBar from '@/components/layout/FilterBar';
import DisplayPopover from '@/components/layout/DisplayPopover';
import KanbanBoard from '@/components/common/board/kanban/KanbanBoard';
import ListView from '@/components/common/board/list/ListView';
import TimelineView from '@/components/common/board/timeline/TimelineView';
import CalendarView from '@/components/common/board/calendar/CalendarView';
import { useNewViewFromUrl } from './hooks/useNewViewFromUrl';
import InsightsButton from '@/features/insights/components/InsightsButton';
import InsightsPanel from '@/features/insights/components/InsightsPanel';
import { useInsightsSettings } from '@/features/insights/hooks/useInsightsSettings';
import { insightsViewKey } from '@/features/insights/utils/settings';
import { contextFromTeam, EMPTY_CONTEXT } from '@/features/insights/utils/context';
import { insightsScope, withSliceFilter } from '@/features/insights/utils/panel';

interface TimelineCollapseState {
  scope: string;
  groups: Set<string>;
}

// The work items page (the index and /view/:viewId child routes of the Shell).
// It renders the saved-view tabs, the inline edit bar and the selected layout;
// the team data and the view editor come from the Shell through React context.
export default function WorkItemsPage() {
  const { team, filteredTeam, views, editor, onOpenIssue, onAddIssue } = useShell();
  const { can } = usePermissions();
  const [timelineCollapseState, setTimelineCollapseState] = useState<TimelineCollapseState>({
    scope: '',
    groups: new Set(),
  });

  const shownTeam = useMemo(
    () =>
      filteredTeam && {
        ...filteredTeam,
        issues: visibleIssues(
          filteredTeam.issues,
          editor.settings,
          new Date(),
          closedStateIds(filteredTeam.states),
        ),
      },
    [filteredTeam, editor.settings],
  );

  useNewViewFromUrl(shownTeam != null, can('views', 'create'), editor.beginNewView);

  const teamId = team?.team.id ?? '';
  const insightsKey = insightsViewKey(
    editor.activeViewId
      ? { kind: 'view', viewId: editor.activeViewId }
      : editor.editing
        ? { kind: 'newView', teamId }
        : { kind: 'allIssues', teamId },
  );
  const insights = useInsightsSettings(insightsKey);
  const insightsContext = useMemo(() => (team ? contextFromTeam(team) : EMPTY_CONTEXT), [team]);

  if (editor.error) return <PreferencesError message={editor.error} onRetry={editor.retry} />;
  if (!team || !filteredTeam || !shownTeam || !editor.ready) return null;

  // Saving persists the view: editing an existing one is a views edit, a brand-new
  // one is a views create. Filtering/display stay available to everyone (transient,
  // client-side); only persisting is gated.
  const canSaveView = can('views', editor.activeView ? 'edit' : 'create');

  const settings = cycleSafeSettings(editor.settings, editor.view, cyclesVisible(team));
  const changeSettings = (next: ViewSettings) => editor.changeSettings(next);

  const timelineGroups = buildGroups(shownTeam, settings.group);
  const timelineIssuesByGroup = groupIssues(timelineGroups, shownTeam.issues, settings.group);
  const visibleTimelineGroupKeys = timelineGroups
    .filter(
      (group) =>
        settings.showEmptyGroups || (timelineIssuesByGroup.get(group.key)?.length ?? 0) > 0,
    )
    .map((group) => group.key);
  const timelineCollapseScope = [
    team.team.key,
    editor.activeViewId ?? 'all',
    settings.group,
    settings.showEmptyGroups,
    settings.timelineCollapseAll,
  ].join(':');
  const initialTimelineCollapsedGroups = settings.timelineCollapseAll
    ? new Set(visibleTimelineGroupKeys)
    : new Set<string>();
  const collapsedTimelineGroups =
    timelineCollapseState.scope === timelineCollapseScope
      ? timelineCollapseState.groups
      : initialTimelineCollapsedGroups;

  const toggleTimelineGroup = (groupKey: string) => {
    setTimelineCollapseState((current) => {
      const groups = new Set(
        current.scope === timelineCollapseScope ? current.groups : initialTimelineCollapsedGroups,
      );
      if (groups.has(groupKey)) groups.delete(groupKey);
      else groups.add(groupKey);
      return { scope: timelineCollapseScope, groups };
    });
  };

  const viewProps = {
    team: shownTeam,
    settings,
    onSettingsChange: changeSettings,
    onOpenIssue,
    onPeekIssue: (id: string) => onOpenIssue(id, 'panel'),
    onAddIssue,
  };

  function renderView() {
    switch (editor.view) {
      case 'list':
        return <ListView {...viewProps} />;
      case 'timeline':
        return (
          <TimelineView
            {...viewProps}
            collapsedGroups={collapsedTimelineGroups}
            onToggleGroup={toggleTimelineGroup}
          />
        );
      case 'calendar':
        return <CalendarView {...viewProps} />;
      default:
        return <KanbanBoard {...viewProps} />;
    }
  }

  const displayProps = {
    view: editor.view,
    onViewChange: editor.changeView,
    settings,
    onSettingsChange: changeSettings,
    cyclesOn: cyclesVisible(team),
  };

  return (
    <>
      <PageHeaderPortal>
        <ViewTabs
          views={views}
          activeViewId={editor.activeViewId}
          onSelect={editor.selectView}
          onNewView={editor.beginNewView}
          onEdit={editor.beginEditView}
          onDelete={(v) => void editor.deleteView(v)}
          onToggleFilter={editor.toggleFilters}
          displayControl={
            <>
              <InsightsButton
                open={insights.settings.open}
                onToggle={() => insights.update({ open: !insights.settings.open })}
              />
              <DisplayPopover {...displayProps} />
            </>
          }
        />
      </PageHeaderPortal>

      {/* The filter row applies to the current screen only; it never writes to a
          view. The edit bar above it (icon picker + name input + Cancel/Save)
          appears only after Edit view or New view, and Save is the one write:
          it updates the active view or creates one from the live state. */}
      {(editor.editing || editor.showFilters) && (
        <div className="border-b">
          {editor.editing && (
            <div className="flex items-center gap-2 px-3 py-2">
              <ViewIconPicker icon={editor.draftIcon} onChange={editor.setDraftIcon} />
              <Input
                value={editor.draftName}
                placeholder="All issues"
                autoFocus
                onChange={(e) => editor.setDraftName(e.target.value)}
                onKeyDown={(e) =>
                  e.key === 'Enter' &&
                  (editor.activeView || editor.draftName.trim()) &&
                  void editor.saveEdits()
                }
                className="h-8 flex-1 border-0 bg-transparent px-1 text-sm font-medium shadow-none focus-visible:ring-0"
              />
              <Button variant="ghost" size="sm" onClick={editor.cancelEdits}>
                Cancel
              </Button>
              {canSaveView && (
                <Button
                  size="sm"
                  disabled={!editor.activeView && !editor.draftName.trim()}
                  onClick={() => void editor.saveEdits()}
                >
                  Save
                </Button>
              )}
            </div>
          )}
          <div className={cn('px-3 pb-2', editor.editing ? '' : 'pt-2')}>
            <FilterBar filters={editor.filters} onChange={editor.changeFilters} team={team} />
          </div>
        </div>
      )}

      <div className="relative flex-1 overflow-hidden">{renderView()}</div>
      {insights.settings.open && (
        <InsightsPanel
          viewKey={insightsKey}
          settings={insights.settings}
          onChange={insights.update}
          scope={insightsScope({ team: { id: { eq: team.team.id } } }, editor.effectiveFilters)}
          viewIssues={shownTeam.issues}
          baseContext={insightsContext}
          showSubIssues={editor.settings.showSubIssues}
          onSliceFilter={(c) => editor.changeFilters(withSliceFilter(editor.filters, c))}
          onOpenIssue={onOpenIssue}
        />
      )}
    </>
  );
}
