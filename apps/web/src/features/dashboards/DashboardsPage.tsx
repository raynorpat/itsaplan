'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useViewerWorkspaceQuery } from '@/services/viewer.service';
import { canSeeFeedback } from '@/utils/feedback';
import DashboardList from './components/DashboardList';
import NewDashboardDialog from './components/NewDashboardDialog';
import { useDashboardsQuery } from './services/dashboards.service';

// Dashboards: the ones the viewer can see, and New dashboard (blank or a template).
// Guests have no dashboards.
export default function DashboardsPage() {
  const viewer = useViewerWorkspaceQuery();
  const visible = canSeeFeedback(viewer.data?.workspaceRole ?? null);
  const query = useDashboardsQuery(visible);
  const [creating, setCreating] = useState(false);

  if (viewer.isPending) return null;
  if (!visible) return <p className="px-6 py-8 text-sm text-muted-foreground">Page not found.</p>;

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div className="flex items-center justify-between gap-4 px-4 py-3">
        <h1 className="text-lg font-semibold">Dashboards</h1>
        <Button size="sm" onClick={() => setCreating(true)}>
          New dashboard
        </Button>
      </div>
      {query.isPending ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">Loading…</p>
      ) : (query.data ?? []).length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">
          No dashboards yet. Create one, or start from a ready-made dashboard.
        </p>
      ) : (
        <DashboardList dashboards={query.data ?? []} />
      )}
      {creating && <NewDashboardDialog onClose={() => setCreating(false)} />}
    </div>
  );
}
