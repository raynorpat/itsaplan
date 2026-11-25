'use client';

import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { useTeamsQuery } from '@/services/teams.service';
import type { CycleFilter, DataKind, ProjectFilter } from '@/utils/dashboards/config';
import DashboardSelect from './DashboardSelect';

const HEALTH = [
  { value: 'onTrack', label: 'On track' },
  { value: 'atRisk', label: 'At risk' },
  { value: 'offTrack', label: 'Off track' },
  { value: 'none', label: 'No update' },
] as const;

// A projects widget's filter (team, health, target date coming up) or a cycles
// widget's (team).
export default function WidgetOtherFilter({
  data,
  filter,
  onChange,
}: {
  data: Exclude<DataKind, 'issues' | 'requests'>;
  filter: ProjectFilter | CycleFilter;
  onChange: (filter: ProjectFilter | CycleFilter) => void;
}) {
  const teams = useTeamsQuery().data ?? [];
  const teamId = filter.teamIds?.[0] ?? 'all';
  const team = (
    <DashboardSelect
      id="widget-team"
      label="Team"
      value={teamId}
      options={[
        { value: 'all', label: 'All teams' },
        ...teams.map((t) => ({ value: t.id, label: t.name })),
      ]}
      onChange={(v) => onChange({ ...filter, teamIds: v === 'all' ? undefined : [v] })}
    />
  );
  if (data === 'cycles') return team;
  const project = filter as ProjectFilter;
  const health = project.health ?? [];
  const toggle = (h: (typeof HEALTH)[number]['value']) =>
    onChange({
      ...project,
      health: health.includes(h) ? health.filter((x) => x !== h) : [...health, h],
    });
  return (
    <div className="grid gap-2">
      {team}
      <fieldset className="flex flex-wrap gap-3 text-sm">
        <legend className="sr-only">Health</legend>
        {HEALTH.map((h) => (
          <label key={h.value} className="flex items-center gap-1.5">
            <Checkbox checked={health.includes(h.value)} onCheckedChange={() => toggle(h.value)} />
            {h.label}
          </label>
        ))}
      </fieldset>
      <label className="flex items-center gap-2 text-sm">
        Target date within
        <Input
          type="number"
          min={1}
          className="h-8 w-20"
          value={project.targetWithinDays ?? ''}
          onChange={(e) =>
            onChange({
              ...project,
              targetWithinDays: e.target.value ? Math.max(1, Number(e.target.value)) : undefined,
            })
          }
        />
        days
      </label>
    </div>
  );
}
