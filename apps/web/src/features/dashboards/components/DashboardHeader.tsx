'use client';

import { Button } from '@/components/ui/button';
import { useTeamsQuery } from '@/services/teams.service';
import { DASHBOARD_PERIODS, PERIOD_LABELS, type DashboardPeriod } from '@/utils/dashboards/config';
import type { DashboardState } from '@/utils/dashboards/loads';
import type { Dashboard } from '../services/dashboards.service';
import DashboardSelect from './DashboardSelect';

export interface DashboardHeaderActions {
  onEdit: () => void;
  onDuplicate: () => void;
  onShare: () => void;
  onDelete: () => void;
  onAddWidget: () => void;
  onSave: () => void;
  onCancel: () => void;
}

// The dashboard's name and description, its period and team, and its actions: Edit,
// Share and Delete for editors, Duplicate for everyone; in edit mode Add widget, Save
// and Cancel.
export default function DashboardHeader({
  dashboard,
  state,
  onState,
  editing,
  saving,
  actions,
}: {
  dashboard: Dashboard;
  state: DashboardState;
  onState: (patch: Partial<DashboardState>) => void;
  editing: boolean;
  saving: boolean;
  actions: DashboardHeaderActions;
}) {
  const teams = useTeamsQuery().data ?? [];
  return (
    <header className="mb-6 grid gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold">{dashboard.name}</h1>
          {dashboard.description && (
            <p className="mt-0.5 text-sm text-muted-foreground">{dashboard.description}</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {editing ? (
            <>
              <Button variant="outline" size="sm" onClick={actions.onAddWidget}>
                Add widget
              </Button>
              <Button variant="ghost" size="sm" onClick={actions.onCancel}>
                Cancel
              </Button>
              <Button size="sm" disabled={saving} onClick={actions.onSave}>
                Save
              </Button>
            </>
          ) : (
            <>
              {dashboard.canEdit && (
                <Button variant="outline" size="sm" onClick={actions.onEdit}>
                  Edit
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={actions.onDuplicate}>
                Duplicate
              </Button>
              {dashboard.canEdit && (
                <>
                  <Button variant="ghost" size="sm" onClick={actions.onShare}>
                    Share
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive"
                    onClick={actions.onDelete}
                  >
                    Delete
                  </Button>
                </>
              )}
            </>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <DashboardSelect
          id="dashboard-period"
          label="Period"
          value={state.period}
          options={DASHBOARD_PERIODS.map((p) => ({ value: p, label: PERIOD_LABELS[p] }))}
          onChange={(v) => onState({ period: v as DashboardPeriod })}
        />
        <DashboardSelect
          id="dashboard-team"
          label="Team"
          value={state.teamId ?? 'all'}
          options={[
            { value: 'all', label: 'All teams' },
            ...teams.map((t) => ({ value: t.id, label: t.name })),
          ]}
          onChange={(v) => onState({ teamId: v === 'all' ? null : v })}
        />
      </div>
    </header>
  );
}
