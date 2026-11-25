'use client';

import { Checkbox } from '@/components/ui/checkbox';
import { useTeamsQuery } from '@/services/teams.service';
import type { DashboardSharing } from '../services/dashboards.service';
import DashboardSelect from './DashboardSelect';

// Who sees a dashboard: the whole workspace, or the members of chosen teams (the
// workspace's owners and admins see every dashboard). Only teams the viewer belongs
// to are offered; the API also lets admins name any team.
export default function DashboardShareFields({
  sharedWith,
  teamIds,
  onChange,
}: {
  sharedWith: DashboardSharing;
  teamIds: string[];
  onChange: (v: { sharedWith: DashboardSharing; teamIds: string[] }) => void;
}) {
  const teams = (useTeamsQuery().data ?? []).filter(
    (t) => t.role != null || teamIds.includes(t.id),
  );
  const toggle = (id: string) =>
    onChange({
      sharedWith,
      teamIds: teamIds.includes(id) ? teamIds.filter((t) => t !== id) : [...teamIds, id],
    });
  return (
    <div className="grid gap-2">
      <DashboardSelect
        id="dashboard-sharing"
        label="Shared with"
        value={sharedWith}
        className="w-56"
        options={[
          { value: 'workspace', label: 'The whole workspace' },
          { value: 'teams', label: 'Chosen teams' },
        ]}
        onChange={(v) => onChange({ sharedWith: v as DashboardSharing, teamIds })}
      />
      {sharedWith === 'teams' && (
        <fieldset className="flex flex-wrap gap-3 text-sm">
          <legend className="sr-only">Teams</legend>
          {teams.map((t) => (
            <label key={t.id} className="flex items-center gap-1.5">
              <Checkbox checked={teamIds.includes(t.id)} onCheckedChange={() => toggle(t.id)} />
              {t.name}
            </label>
          ))}
        </fieldset>
      )}
    </div>
  );
}
