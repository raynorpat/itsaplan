'use client';

import { useProjectQuery } from '@/services/projects.service';
import type { TeamDetail } from '@/types/team';
import type { SummaryContext } from '../utils/ruleForm';

// The names an action summary reads from the team, plus `projectId`'s project, which
// the team data does not carry.
export function useSummaryContext(team: TeamDetail, projectId: string | null): SummaryContext {
  const project = useProjectQuery(projectId).data;
  return {
    states: team.states,
    labels: team.labels,
    users: [...team.assignees, ...team.delegates],
    projects: project ? [project] : [],
    cycles: team.teamCycles,
  };
}
