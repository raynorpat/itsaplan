import type { TeamDetail } from '@/types/team';
import { cycleLabel } from '@/utils/cycles';
import type { InsightsContext } from './slices';

// The names a team's view knows: its states, people, labels, cycles and the team.
export function contextFromTeam(team: TeamDetail): InsightsContext {
  return {
    states: new Map(
      team.states.map((s) => [
        s.id,
        { name: s.name, type: s.stateType, position: s.position, color: s.color },
      ]),
    ),
    users: new Map(
      [...team.mentionCandidates, ...team.assignees].map((a) => [a.userId, a.name] as const),
    ),
    labels: new Map(team.labels.map((l) => [l.id, l.name])),
    cycles: new Map(team.teamCycles.map((c) => [c.id, cycleLabel(c)])),
    teams: new Map([[team.team.id, team.team.name]]),
  };
}

function merged<V>(base: ReadonlyMap<string, V>, extra: ReadonlyMap<string, V>): Map<string, V> {
  return new Map([...extra, ...base]);
}

// The view's names with the fetched issues' names filling the gaps (people, past
// cycles, other teams); a name the view holds wins, as it reflects edits on the page.
export function mergeContext(base: InsightsContext, extra: InsightsContext): InsightsContext {
  return {
    states: merged(base.states, extra.states),
    users: merged(base.users, extra.users),
    labels: merged(base.labels, extra.labels),
    cycles: merged(base.cycles, extra.cycles),
    teams: merged(base.teams, extra.teams),
  };
}

export const EMPTY_CONTEXT: InsightsContext = {
  states: new Map(),
  users: new Map(),
  labels: new Map(),
  cycles: new Map(),
  teams: new Map(),
};
