'use client';

import { useState } from 'react';
import Modal from '@/components/common/overlay/Modal';
import { Button } from '@/components/ui/button';
import { useUpdateDashboard, type Dashboard } from '../services/dashboards.service';
import DashboardShareFields from './DashboardShareFields';

// Changes who sees a dashboard (editors). Sharing never changes a widget's data: each
// viewer's widgets follow what they may read.
export default function DashboardShareDialog({
  dashboard,
  onClose,
}: {
  dashboard: Dashboard;
  onClose: () => void;
}) {
  const [share, setShare] = useState({
    sharedWith: dashboard.sharedWith,
    teamIds: dashboard.teamIds,
  });
  const update = useUpdateDashboard();
  const invalid = share.sharedWith === 'teams' && share.teamIds.length === 0;
  return (
    <Modal title="Share dashboard" onClose={onClose}>
      <div className="grid gap-4">
        <DashboardShareFields {...share} onChange={setShare} />
        <p className="text-xs text-muted-foreground">
          Everyone it is shared with sees figures from the work they can access.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={invalid || update.isPending}
            onClick={async () => {
              await update.mutateAsync({ id: dashboard.id, ...share });
              onClose();
            }}
          >
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}
