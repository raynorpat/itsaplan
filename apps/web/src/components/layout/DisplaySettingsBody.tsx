import type { WorkItemsView } from '@/utils/viewTypes';
import type { ViewSettings } from '@/utils/viewSettings';
import DisplayCalendarRows from '@/components/layout/DisplayCalendarRows';
import DisplayGroupingRows from '@/components/layout/DisplayGroupingRows';
import DisplayIssueRows from '@/components/layout/DisplayIssueRows';
import DisplayLayoutTabs from '@/components/layout/DisplayLayoutTabs';
import DisplayPropertiesSection from '@/components/layout/DisplayPropertiesSection';
import DisplayTimelineRows from '@/components/layout/DisplayTimelineRows';

// The body of the Display menu, in Linear's order: the layout switcher (List and
// Board, with Timeline and Calendar as extra layouts), grouping and ordering, which
// issues show, then the selected layout's own options and display properties. Rendered inside
// the DisplayPopover. Settings belong to the active team+view or saved view
// (see the view editor and lib/viewSettings).
export default function DisplaySettingsBody({
  view,
  onViewChange,
  settings,
  onSettingsChange,
  cyclesOn,
  requestsOn,
  estimatesOn,
}: {
  view: WorkItemsView;
  onViewChange: (view: WorkItemsView) => void;
  settings: ViewSettings;
  onSettingsChange: (settings: ViewSettings) => void;
  cyclesOn: boolean;
  requestsOn: boolean;
  estimatesOn?: boolean;
}) {
  const set = (patch: Partial<ViewSettings>) => onSettingsChange({ ...settings, ...patch });

  return (
    <div className="space-y-2">
      <DisplayLayoutTabs view={view} onViewChange={onViewChange} />

      <DisplayGroupingRows
        view={view}
        settings={settings}
        onChange={set}
        cyclesOn={cyclesOn}
        requestsOn={requestsOn}
        estimatesOn={estimatesOn}
      />

      <DisplayIssueRows settings={settings} onChange={set} />

      {view === 'timeline' && <DisplayTimelineRows settings={settings} onChange={set} />}

      {view === 'calendar' && <DisplayCalendarRows settings={settings} onChange={set} />}

      {(view === 'kanban' || view === 'list') && (
        <DisplayPropertiesSection
          settings={settings}
          onChange={set}
          cyclesOn={cyclesOn}
          requestsOn={requestsOn}
          estimatesOn={estimatesOn}
        />
      )}
    </div>
  );
}
