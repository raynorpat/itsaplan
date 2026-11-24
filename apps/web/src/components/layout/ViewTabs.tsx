import { type ReactNode } from 'react';
import { Filter, Plus } from 'lucide-react';
import type { View } from '@/types/team';
import { usePermissions } from '@/hooks/usePermissions';
import AllViewTab from '@/components/layout/AllViewTab';
import MobileViewSwitcher from '@/components/layout/MobileViewSwitcher';
import SavedViewTab from '@/components/layout/SavedViewTab';

// The saved-view tabs of a team's issues, plus a New view button and, on the
// right, the filter and display toggles. Rendered in the page header line (see
// PageHeaderPortal), as in Linear. The leading "All" tab is implicit and
// has no filters; it cannot be deleted. Saved tabs are in creation order. The filter
// toggle
// shows the filter row, which filters the current screen only; onEdit opens the
// edit bar for a view (see WorkItemsPage).
export default function ViewTabs({
  views,
  activeViewId,
  onSelect,
  onNewView,
  onEdit,
  onDelete,
  onToggleFilter,
  displayControl,
}: {
  views: View[];
  activeViewId: string | null;
  onSelect: (id: string | null) => void;
  onNewView: () => void;
  onEdit: (view: View) => void;
  onDelete: (view: View) => void;
  onToggleFilter: () => void;
  displayControl: ReactNode;
}) {
  const { can } = usePermissions();
  const canCreateView = can('views', 'create');
  const canEditView = can('views', 'edit');
  const canDeleteView = can('views', 'delete');
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      {/* Mobile: views collapse into a dropdown. */}
      <div className="flex min-w-0 flex-1 items-center sm:hidden">
        <MobileViewSwitcher
          views={views}
          activeViewId={activeViewId}
          canCreate={canCreateView}
          onSelect={onSelect}
          onNewView={onNewView}
        />
      </div>

      {/* Desktop: the scrollable tab strip. */}
      <div className="hidden min-w-0 flex-1 items-center gap-1 overflow-x-auto sm:flex">
        <AllViewTab active={activeViewId === null} onClick={() => onSelect(null)} />

        {views.map((view) => (
          <SavedViewTab
            key={view.id}
            view={view}
            active={activeViewId === view.id}
            canEdit={canEditView}
            canDelete={canDeleteView}
            onSelect={() => onSelect(view.id)}
            onEdit={() => onEdit(view)}
            onDelete={() => onDelete(view)}
          />
        ))}

        {canCreateView && (
          <button
            type="button"
            onClick={onNewView}
            title="Create a view from the current filters and display"
            className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Plus className="size-3.5" />
            New view
          </button>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-0.5 pl-2">
        <button
          type="button"
          onClick={onToggleFilter}
          title="Filter"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Filter className="size-4" />
        </button>
        {displayControl}
      </div>
    </div>
  );
}
