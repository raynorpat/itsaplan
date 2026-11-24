'use client';

import { useProjectQuery } from '@/services/projects.service';
import type { TeamDetail } from '@/types/team';
import { useAutomationCycleQuery } from '../services/automations.service';
import type { SummaryContext } from '../utils/ruleForm';
import type { WorkflowAction } from '../utils/rules';

// The names `action`'s summary reads: the team's states, labels, members and open
// cycles, plus the project or completed cycle it points at, which the team data does
// not carry. Those two are loaded by id and count as pending until their query answers.
export function useSummaryContext(team: TeamDetail, action: WorkflowAction): SummaryContext {
  const projectId = action.type === 'setProject' ? action.projectId : null;
  const cycleId =
    action.type === 'setCycle' &&
    action.cycleId &&
    !team.teamCycles.some((c) => c.id === action.cycleId)
      ? action.cycleId
      : null;
  const project = useProjectQuery(projectId);
  const cycle = useAutomationCycleQuery(cycleId);
  const pendingIds = [
    ...(projectId && project.isLoading ? [projectId] : []),
    ...(cycleId && cycle.isLoading ? [cycleId] : []),
  ];
  return {
    states: team.states,
    labels: team.labels,
    users: [...team.assignees, ...team.delegates],
    projects: project.data ? [project.data] : [],
    cycles: cycle.data ? [...team.teamCycles, cycle.data] : team.teamCycles,
    pendingIds,
  };
}
