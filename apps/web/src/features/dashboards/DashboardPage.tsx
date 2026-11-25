'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import ConfirmDialog from '@/components/common/overlay/ConfirmDialog';
import { useViewerWorkspaceQuery } from '@/services/viewer.service';
import { canSeeFeedback } from '@/utils/feedback';
import { dashboardPath, dashboardsPath } from '@/utils/paths';
import type { Widget } from '@/utils/dashboards/config';
import DashboardGrid from './components/DashboardGrid';
import DashboardHeader from './components/DashboardHeader';
import DashboardShareDialog from './components/DashboardShareDialog';
import WidgetEditor from './components/WidgetEditor';
import { useDashboardFilters } from './hooks/useDashboardFilters';
import {
  useDashboardQuery,
  useDeleteDashboard,
  useDuplicateDashboard,
  useUpdateDashboard,
} from './services/dashboards.service';
import { newWidget } from './utils/layout';

// One dashboard: its widgets for the chosen period and team, and edit mode (add,
// configure, resize, drag and remove widgets, then Save) for its editors. Guests have
// no dashboards.
export default function DashboardPage({ dashboardId }: { dashboardId: string }) {
  const router = useRouter();
  const viewer = useViewerWorkspaceQuery();
  const visible = canSeeFeedback(viewer.data?.workspaceRole ?? null);
  const query = useDashboardQuery(visible ? dashboardId : null);
  const [state, setState] = useDashboardFilters(dashboardId);
  const [draft, setDraft] = useState<Widget[] | null>(null);
  const [editing, setEditing] = useState<{ widget: Widget; adding: boolean } | null>(null);
  const [dialog, setDialog] = useState<'share' | 'delete' | null>(null);
  const update = useUpdateDashboard();
  const duplicate = useDuplicateDashboard();
  const remove = useDeleteDashboard();

  if (viewer.isPending || (visible && query.isPending)) return null;
  const dashboard = query.data;
  if (!visible || !dashboard)
    return <p className="px-6 py-8 text-sm text-muted-foreground">Dashboard not found.</p>;

  const widgets = draft ?? dashboard.widgets;
  const saveWidget = (w: Widget) => {
    setDraft((d) => {
      const list = d ?? dashboard.widgets;
      return list.some((x) => x.id === w.id)
        ? list.map((x) => (x.id === w.id ? w : x))
        : [...list, w];
    });
    setEditing(null);
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-[1400px] px-4 py-5 sm:px-6">
        <DashboardHeader
          dashboard={dashboard}
          state={state}
          onState={setState}
          editing={draft !== null}
          saving={update.isPending}
          actions={{
            onEdit: () => setDraft(dashboard.widgets),
            onCancel: () => setDraft(null),
            onSave: async () => {
              await update.mutateAsync({ id: dashboard.id, widgets: draft ?? [] });
              setDraft(null);
            },
            onAddWidget: () => setEditing({ widget: newWidget('issues'), adding: true }),
            onDuplicate: async () =>
              router.push(dashboardPath((await duplicate.mutateAsync(dashboard.id)).id)),
            onShare: () => setDialog('share'),
            onDelete: () => setDialog('delete'),
          }}
        />
        {widgets.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            {draft ? 'Add a widget to start.' : 'This dashboard has no widgets yet.'}
          </p>
        ) : (
          <DashboardGrid
            widgets={widgets}
            dashboard={state}
            editing={draft !== null}
            onChange={setDraft}
            onEdit={(widget) => setEditing({ widget, adding: false })}
          />
        )}
      </div>
      {editing && (
        <WidgetEditor
          initial={editing.widget}
          adding={editing.adding}
          onSave={saveWidget}
          onClose={() => setEditing(null)}
        />
      )}
      {dialog === 'share' && (
        <DashboardShareDialog dashboard={dashboard} onClose={() => setDialog(null)} />
      )}
      {dialog === 'delete' && (
        <ConfirmDialog
          title="Delete dashboard"
          confirmLabel="Delete"
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            await remove.mutateAsync(dashboard.id);
            router.push(dashboardsPath());
          }}
        >
          <p className="text-sm text-muted-foreground">
            “{dashboard.name}” will be deleted for everyone it is shared with.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
