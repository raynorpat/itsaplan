// React Query hooks for everything the settings feature reads and writes: the
// team's workflow states, labels and label groups, the auto-archive period, the team
// cycle settings, and the session member's own notification preferences. Structural
// writes go through useTeamMutation and invalidate the team scaffold; the settings
// writes put the stored result straight into the cache.

import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  api,
  type Issue,
  type LabelGroup,
  type NotificationPreferences,
  type StateType,
  type TeamScaffold,
} from '@/lib/api';
import { graphql, gqlRequest } from '@/lib/graphql';
import { DEFAULT_COLOR } from '@/utils/team';
import type { CycleSettingsInput } from '../utils/cycleSettings';
import {
  labelCreateInput,
  labelGroupCreateInput,
  labelUpdateInput,
  type LabelFields,
} from '../utils/labelInput';
import { removeState } from '../utils/removeState';
import { fetchTeamScaffold } from '@/services/board.service';
import { useInvalidateTeam } from '@/services/teams.service';
import { qk } from '@/services/queryKeys';

// A mutation whose success invalidates the team scaffold (and dependent lists).
// Shared by every structural write below.
function useTeamMutation<TArgs, TResult>(
  teamKey: string,
  mutationFn: (args: TArgs) => Promise<TResult>,
) {
  const invalidate = useInvalidateTeam(teamKey);
  return useMutation({ mutationFn, onSuccess: () => invalidate() });
}

// The team's id, which label inputs require (the team key is accepted elsewhere). It
// comes from the team scaffold, which every settings page has loaded.
async function teamIdOf(qc: QueryClient, teamKey: string): Promise<string> {
  const scaffold = await qc.ensureQueryData<TeamScaffold>({
    queryKey: qk.team(teamKey),
    queryFn: () => fetchTeamScaffold(teamKey),
  });
  return scaffold.team.id;
}

// --- Workflow states ---------------------------------------------------------------

const StateCreate = graphql(`
  mutation SettingsStateCreate($input: WorkflowStateCreateInput!) {
    workflowStateCreate(input: $input) {
      success
    }
  }
`);

const StateUpdate = graphql(`
  mutation SettingsStateUpdate($id: String!, $input: WorkflowStateUpdateInput!) {
    workflowStateUpdate(id: $id, input: $input) {
      success
    }
  }
`);

const StateArchive = graphql(`
  mutation SettingsStateArchive($id: String!) {
    workflowStateArchive(id: $id) {
      success
    }
  }
`);

const MoveIssues = graphql(`
  mutation SettingsMoveIssues($ids: [UUID!]!, $input: IssueUpdateInput!) {
    issueBatchUpdate(ids: $ids, input: $input) {
      success
    }
  }
`);

const MoveIssue = graphql(`
  mutation SettingsMoveIssue($id: String!, $input: IssueUpdateInput!) {
    issueUpdate(id: $id, input: $input) {
      success
    }
  }
`);

export function useCreateColumn(teamKey: string) {
  return useTeamMutation(teamKey, (input: { name: string; stateType: StateType; color?: string }) =>
    // workflowStateCreate takes the team key as its teamId, as team(id:) does.
    gqlRequest(StateCreate, {
      input: {
        teamId: teamKey,
        name: input.name,
        type: input.stateType,
        color: input.color ?? DEFAULT_COLOR,
      },
    }),
  );
}

export function useUpdateColumn(teamKey: string) {
  return useTeamMutation(
    teamKey,
    ({ id, patch }: { id: string; patch: { name?: string; color?: string } }) =>
      gqlRequest(StateUpdate, { id, input: patch }),
  );
}

// Moves one state; `position` comes from positionForMove.
export function useReorderColumns(teamKey: string) {
  return useTeamMutation(teamKey, ({ id, position }: { id: string; position: number }) =>
    gqlRequest(StateUpdate, { id, input: { position } }),
  );
}

// Removes a state as Linear does: its active issues move to the target state, then the
// state is archived. Issues that could not move are named in a toast and the state
// stays.
export function useRemoveState(teamKey: string) {
  const qc = useQueryClient();
  return useTeamMutation(
    teamKey,
    async ({ stateId, targetStateId }: { stateId: string; targetStateId: string | null }) => {
      const issues = qc.getQueryData<Issue[]>(qk.boardIssues(teamKey)) ?? [];
      const inState = issues.filter((i) => i.stateId === stateId);
      const input = { stateId: targetStateId };
      const result = await removeState(
        inState.map((i) => i.id),
        {
          moveChunk: (ids) => gqlRequest(MoveIssues, { ids, input }),
          moveOne: (id) => gqlRequest(MoveIssue, { id, input }),
          archive: () => gqlRequest(StateArchive, { id: stateId }),
        },
      );
      if (result.failed.length > 0) {
        const name = new Map(inState.map((i) => [i.id, i.identifier]));
        const list = result.failed.map((f) => `${name.get(f.id) ?? f.id} (${f.message})`);
        toast.error(
          `The state was kept: ${result.failed.length} issue${
            result.failed.length === 1 ? '' : 's'
          } could not be moved: ${list.join(', ')}`,
        );
      }
      return result;
    },
  );
}

// --- Labels and label groups -------------------------------------------------------

const LabelCreate = graphql(`
  mutation SettingsLabelCreate($input: IssueLabelCreateInput!) {
    issueLabelCreate(input: $input) {
      issueLabel {
        id
        name
        color
        team {
          id
        }
      }
    }
  }
`);

const LabelUpdate = graphql(`
  mutation SettingsLabelUpdate($id: String!, $input: IssueLabelUpdateInput!) {
    issueLabelUpdate(id: $id, input: $input) {
      success
    }
  }
`);

const LabelDelete = graphql(`
  mutation SettingsLabelDelete($id: String!) {
    issueLabelDelete(id: $id) {
      success
    }
  }
`);

export function useCreateLabel(teamKey: string) {
  const qc = useQueryClient();
  return useTeamMutation(teamKey, async (fields: LabelFields & { name: string }) =>
    gqlRequest(LabelCreate, { input: labelCreateInput(await teamIdOf(qc, teamKey), fields) }),
  );
}

export function useUpdateLabel(teamKey: string) {
  return useTeamMutation(teamKey, ({ id, patch }: { id: string; patch: LabelFields }) =>
    gqlRequest(LabelUpdate, { id, input: labelUpdateInput(patch) }),
  );
}

export function useDeleteLabel(teamKey: string) {
  return useTeamMutation(teamKey, (id: string) => gqlRequest(LabelDelete, { id }));
}

// A label group is a label with isGroup. The created group is returned so the labels
// import can place new labels in it.
export function useCreateLabelGroup(teamKey: string) {
  const qc = useQueryClient();
  return useTeamMutation(
    teamKey,
    async (fields: { name: string; color?: string }): Promise<LabelGroup> => {
      const data = await gqlRequest(LabelCreate, {
        input: labelGroupCreateInput(await teamIdOf(qc, teamKey), fields),
      });
      const group = data.issueLabelCreate.issueLabel;
      return { id: group.id, teamId: group.team?.id ?? null, name: group.name, color: group.color };
    },
  );
}

export function useUpdateLabelGroup(teamKey: string) {
  return useTeamMutation(
    teamKey,
    ({ id, patch }: { id: string; patch: { name?: string; color?: string } }) =>
      gqlRequest(LabelUpdate, { id, input: labelUpdateInput(patch) }),
  );
}

// Deleting a group ungroups its labels (the API's rule).
export function useDeleteLabelGroup(teamKey: string) {
  return useTeamMutation(teamKey, (id: string) => gqlRequest(LabelDelete, { id }));
}

// --- Auto-archive ------------------------------------------------------------------

const AutoArchiveQuery = graphql(`
  query SettingsAutoArchive($id: String!) {
    team(id: $id) {
      autoArchivePeriod
    }
  }
`);

const AutoArchiveUpdate = graphql(`
  mutation SettingsAutoArchiveUpdate($id: String!, $input: TeamUpdateInput!) {
    teamUpdate(id: $id, input: $input) {
      team {
        autoArchivePeriod
      }
    }
  }
`);

// Archive section: the team's auto-archive period in months.
export function useAutoArchiveQuery(teamKey: string) {
  return useQuery({
    queryKey: qk.teamSettings(teamKey),
    queryFn: async () => (await gqlRequest(AutoArchiveQuery, { id: teamKey })).team,
    select: (t) => t.autoArchivePeriod,
  });
}

export function useUpdateAutoArchive(teamKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (autoArchivePeriod: number) =>
      (await gqlRequest(AutoArchiveUpdate, { id: teamKey, input: { autoArchivePeriod } }))
        .teamUpdate.team,
    onSuccess: (team) => qc.setQueryData(qk.teamSettings(teamKey), team),
  });
}

const TeamCyclesUpdate = graphql(`
  mutation TeamCyclesUpdate($id: String!, $input: TeamUpdateInput!) {
    teamUpdate(id: $id, input: $input) {
      team {
        cyclesEnabled
        cycleDuration
        cycleStartDay
        cycleCooldownTime
        upcomingCycleCount
        cycleIssueAutoAssignStarted
        cycleIssueAutoAssignCompleted
      }
    }
  }
`);

// Cycles section: writes the team's cycle settings through teamUpdate and puts the
// stored values into the team scaffold, which the settings form and the sidebar read.
// Turning cycles on makes the API create the current and upcoming cycles, so the
// team's cycle queries refresh too.
export function useUpdateTeamCycles(teamKey: string, teamId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CycleSettingsInput) => gqlRequest(TeamCyclesUpdate, { id: teamId, input }),
    onSuccess: ({ teamUpdate: { team } }) => {
      if (!team) return;
      qc.setQueryData<TeamScaffold>(qk.team(teamKey), (old) =>
        old
          ? {
              ...old,
              cycles: {
                enabled: team.cyclesEnabled,
                duration: team.cycleDuration,
                startDay: team.cycleStartDay,
                cooldown: team.cycleCooldownTime,
                upcomingCount: team.upcomingCycleCount,
                autoAssignStarted: team.cycleIssueAutoAssignStarted,
                autoAssignCompleted: team.cycleIssueAutoAssignCompleted,
              },
            }
          : old,
      );
      // Turning cycles on makes the API create the current and upcoming cycles; the
      // scaffold and the cycles pages list them.
      void qc.invalidateQueries({ queryKey: qk.team(teamKey) });
      void qc.invalidateQueries({ queryKey: qk.anyCycles });
      void qc.invalidateQueries({ queryKey: qk.anyCycle });
    },
  });
}

// The signed-in user's own email notification preferences, for the whole workspace.
// A write returns the full result, which replaces the cache directly.
export function useNotificationPreferencesQuery() {
  return useQuery({
    queryKey: qk.notificationPreferences(),
    queryFn: () => api.getNotificationPreferences(),
  });
}

export function useUpdateNotificationPreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NotificationPreferences) => api.setNotificationPreferences(input),
    onSuccess: (data) => qc.setQueryData(qk.notificationPreferences(), data),
  });
}
