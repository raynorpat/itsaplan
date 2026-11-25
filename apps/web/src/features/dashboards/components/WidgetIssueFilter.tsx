'use client';

import FilterBar from '@/components/layout/FilterBar';
import { useTeamScaffold } from '@/services/board.service';
import { useTeamsQuery } from '@/services/teams.service';
import type { FilterCondition } from '@/utils/filters';
import DashboardSelect from './DashboardSelect';

const ANY = 'all';

// An issues or requests widget's filter: a team (the dashboard-only "team" condition),
// then, once a team is picked, the issue view filter over that team's states, labels
// and people.
export default function WidgetIssueFilter({
  conditions,
  onChange,
}: {
  conditions: FilterCondition[];
  onChange: (conditions: FilterCondition[]) => void;
}) {
  const teams = useTeamsQuery().data ?? [];
  const teamCondition = conditions.find((c) => c.field === 'team' && c.op === 'is');
  const teamId = typeof teamCondition?.values[0] === 'string' ? teamCondition.values[0] : null;
  const teamKey = teams.find((t) => t.id === teamId)?.key ?? null;
  const scaffold = useTeamScaffold(teamKey).data;
  const rest = conditions.filter((c) => c.field !== 'team');

  const setTeam = (value: string) =>
    onChange(
      value === ANY ? [] : [{ id: crypto.randomUUID(), field: 'team', op: 'is', values: [value] }],
    );

  return (
    <div className="grid gap-2">
      <DashboardSelect
        id="widget-team"
        label="Team"
        value={teamId ?? ANY}
        options={[
          { value: ANY, label: 'All teams' },
          ...teams.map((t) => ({ value: t.id, label: t.name })),
        ]}
        onChange={setTeam}
      />
      {scaffold && teamCondition && (
        <FilterBar
          filters={{ conditions: rest }}
          team={{ ...scaffold, issues: [] }}
          onChange={(f) => onChange([teamCondition, ...f.conditions])}
        />
      )}
      {!teamCondition && (
        <p className="text-xs text-muted-foreground">
          Pick a team to filter by state, label or people.
        </p>
      )}
    </div>
  );
}
