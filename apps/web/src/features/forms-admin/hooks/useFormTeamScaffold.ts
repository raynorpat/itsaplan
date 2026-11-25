import { useTeamScaffold } from '@/services/board.service';
import { useTeamsQuery } from '@/services/teams.service';

// The form team's statuses and labels that can still be chosen (no archived status,
// no retired label, no label group), or empty lists before a team is chosen.
export function useFormTeamScaffold(teamId: string) {
  const teamKey = useTeamsQuery().data?.find((t) => t.id === teamId)?.key ?? null;
  const scaffold = useTeamScaffold(teamKey).data;
  return {
    states: (scaffold?.states ?? []).filter((s) => !s.archivedAt),
    labels: (scaffold?.labels ?? []).filter((l) => !l.retiredAt),
    labelGroups: scaffold?.labelGroups ?? [],
  };
}
