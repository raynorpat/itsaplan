'use client';

import FilterBar from '@/components/layout/FilterBar';
import { useTeamScaffold } from '@/services/board.service';
import { useTeamsQuery } from '@/services/teams.service';
import type { FilterCondition } from '@/utils/filters';
import { withTeam } from '../utils/filterChips';
import DashboardSelect from './DashboardSelect';
import WidgetFilterChips from './WidgetFilterChips';

const ANY = 'all';

// An issues or requests widget's filter: a team (the dashboard-only "team" condition),
// then, once a team is picked, the issue view filter over that team's states, labels
// and people. Changing the team keeps the other conditions; with "All teams" they are
// listed and can be removed.
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

  const setTeam = (value: string) => onChange(withTeam(conditions, value === ANY ? null : value));

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
        <>
          <WidgetFilterChips
            conditions={rest}
            onRemove={(id) => onChange(conditions.filter((c) => c.id !== id))}
          />
          <p className="text-xs text-muted-foreground">
            Pick a team to filter by state, label or people.
          </p>
        </>
      )}
    </div>
  );
}
