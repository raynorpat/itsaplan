// React Query hooks for everything the settings feature reads and writes: the
// team's workflow states, labels and label groups, the auto-archive period, the team
// cycle settings, and the session member's own notification preferences. Structural
// writes go through useTeamMutation and invalidate the team scaffold; the settings
// writes put the stored result straight into the cache.

import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { EstimationType } from '@/utils/estimates';
import type { estimateSettingsInput } from '../utils/estimateSettings';
import type { Issue } from '@/types/issue';
import type { Label, LabelGroup, StateType, TeamScaffold } from '@/types/team';
import type { NotificationPreferences } from '@/features/settings/utils/notificationPreferences';
import { graphql, gqlRequest } from '@/lib/graphql';
import { DEFAULT_COLOR } from '@/utils/team';
import type { CycleSettingsInput } from '../utils/cycleSettings';
import {
  labelCreateInput,
  labelGroupCreateInput,
  labelUpdateInput,
  type LabelFields,
} from '../utils/labelInput';
import { removeState, stateRemovalBlock } from '../utils/removeState';
import {
  toCategoryPreferencesInput,
  toNotificationPreferences,
} from '../utils/notificationPreferences';
import { fetchTeamScaffold } from '@/services/board.service';
import { useInvalidateTeam } from '@/services/teams.service';
import { qk } from '@/services/queryKeys';
import { fetchAllPages } from '@/utils/fetchAllPages';

// A mutation whose success invalidates the team scaffold (and dependent lists).
// Shared by every structural write below.
function useTeamMutation<TArgs, TResult>(
  teamKey: string,
  mutationFn: (args: TArgs) => Promise<TResult>,
) {
  const invalidate = useInvalidateTeam(teamKey);
  // onSettled, not onSuccess: a write that fails partway (a state removal that moved
  // some issues) still changed data the team and board caches hold.
  return useMutation({ mutationFn, onSettled: () => invalidate() });
}

// A label write. A team label refreshes its team like any structural write. A
// workspace label (null team) is part of every team's labels, so it refreshes the
// workspace labels list, every team scaffold and board, and any open issue.
function useLabelMutation<TArgs, TResult>(
  teamKey: string | null,
  mutationFn: (args: TArgs) => Promise<TResult>,
) {
  const qc = useQueryClient();
  const invalidateTeam = useInvalidateTeam(teamKey);
  return useMutation({
    mutationFn,
    onSettled: () => {
      if (teamKey) {
        invalidateTeam();
        return;
      }
      void qc.invalidateQueries({ queryKey: qk.workspaceLabels });
      void qc.invalidateQueries({ queryKey: ['workItems'] });
      void qc.invalidateQueries({ queryKey: ['boardIssues'] });
      void qc.invalidateQueries({ queryKey: qk.anyIssue });
    },
  });
}

// The team's id, which label inputs require (the team key is accepted elsewhere). It
// comes from the team scaffold, which every settings page has loaded.
async function teamIdOf(qc: QueryClient, teamKey: string | null): Promise<string | null> {
  if (teamKey == null) return null;
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
// state is archived. Issues that could not move are returned with their identifiers
// and the state stays; a state the API would refuse to archive moves nothing.
export function useRemoveState(teamKey: string) {
  const qc = useQueryClient();
  return useTeamMutation(
    teamKey,
    async ({
      stateId,
      targetStateId,
      states,
    }: {
      stateId: string;
      targetStateId: string | null;
      states: { id: string; stateType: string }[];
    }) => {
      const state = states.find((s) => s.id === stateId);
      const blocked = state ? stateRemovalBlock(state, states) : null;
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
        blocked,
      );
      const name = new Map(inState.map((i) => [i.id, i.identifier]));
      return {
        ...result,
        failed: result.failed.map((f) => ({ ...f, identifier: name.get(f.id) ?? f.id })),
      };
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

export function useCreateLabel(teamKey: string | null) {
  const qc = useQueryClient();
  return useLabelMutation(teamKey, async (fields: LabelFields & { name: string }) =>
    gqlRequest(LabelCreate, { input: labelCreateInput(await teamIdOf(qc, teamKey), fields) }),
  );
}

export function useUpdateLabel(teamKey: string | null) {
  return useLabelMutation(teamKey, ({ id, patch }: { id: string; patch: LabelFields }) =>
    gqlRequest(LabelUpdate, { id, input: labelUpdateInput(patch) }),
  );
}

export function useDeleteLabel(teamKey: string | null) {
  return useLabelMutation(teamKey, (id: string) => gqlRequest(LabelDelete, { id }));
}

// Retiring keeps the label on the issues that carry it and hides it from the pickers;
// restoring offers it again (Linear's issueLabelRetire / issueLabelRestore).
const LabelRetire = graphql(`
  mutation SettingsLabelRetire($id: String!) {
    issueLabelRetire(id: $id) {
      success
    }
  }
`);

const LabelRestore = graphql(`
  mutation SettingsLabelRestore($id: String!) {
    issueLabelRestore(id: $id) {
      success
    }
  }
`);

export function useRetireLabel(teamKey: string | null) {
  return useLabelMutation(teamKey, (id: string) => gqlRequest(LabelRetire, { id }));
}

export function useRestoreLabel(teamKey: string | null) {
  return useLabelMutation(teamKey, (id: string) => gqlRequest(LabelRestore, { id }));
}

// A label group is a label with isGroup. The created group is returned so the labels
// import can place new labels in it.
export function useCreateLabelGroup(teamKey: string | null) {
  const qc = useQueryClient();
  return useLabelMutation(
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

export function useUpdateLabelGroup(teamKey: string | null) {
  return useLabelMutation(
    teamKey,
    ({ id, patch }: { id: string; patch: { name?: string; color?: string } }) =>
      gqlRequest(LabelUpdate, { id, input: labelUpdateInput(patch) }),
  );
}

// Deleting a group ungroups its labels (the API's rule).
export function useDeleteLabelGroup(teamKey: string | null) {
  return useLabelMutation(teamKey, (id: string) => gqlRequest(LabelDelete, { id }));
}

// The workspace labels and groups: labels without a team, retired ones included (the
// API serves a retired label as archived), sorted by name.
const WorkspaceLabelsPage = graphql(`
  query SettingsWorkspaceLabels($after: String, $first: Int) {
    issueLabels(
      filter: { team: { null: true } }
      includeArchived: true
      first: $first
      after: $after
    ) {
      nodes {
        id
        name
        color
        isGroup
        archivedAt
        parent {
          id
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`);

export function useWorkspaceLabels() {
  return useQuery({
    queryKey: qk.workspaceLabels,
    queryFn: async (): Promise<{ labels: Label[]; groups: LabelGroup[] }> => {
      const nodes = await fetchAllPages(async (after, first) => {
        const { issueLabels } = await gqlRequest(WorkspaceLabelsPage, { after, first });
        return issueLabels;
      });
      const labels: Label[] = [];
      const groups: LabelGroup[] = [];
      for (const l of nodes) {
        if (l.isGroup) groups.push({ id: l.id, teamId: null, name: l.name, color: l.color });
        else
          labels.push({
            id: l.id,
            teamId: null,
            groupId: l.parent?.id ?? null,
            name: l.name,
            color: l.color,
            retiredAt: l.archivedAt ?? null,
          });
      }
      const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
      return { labels: labels.sort(byName), groups: groups.sort(byName) };
    },
  });
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
      // The sidebar shows a team's Cycles entry from the teams list.
      void qc.invalidateQueries({ queryKey: qk.teams });
      void qc.invalidateQueries({ queryKey: qk.anyCycle });
    },
  });
}

const TeamEstimatesUpdate = graphql(`
  mutation TeamEstimatesUpdate($id: String!, $input: TeamUpdateInput!) {
    teamUpdate(id: $id, input: $input) {
      team {
        issueEstimationType
        issueEstimationExtended
        issueEstimationAllowZero
        defaultIssueEstimate
      }
    }
  }
`);

// Estimates section: writes the team's estimate scale through teamUpdate and puts the
// stored values into the team scaffold, which the pickers, chips and Display menu read.
export function useUpdateTeamEstimates(teamKey: string, teamId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ReturnType<typeof estimateSettingsInput>) =>
      gqlRequest(TeamEstimatesUpdate, { id: teamId, input }),
    onSuccess: ({ teamUpdate: { team } }) => {
      if (!team) return;
      qc.setQueryData<TeamScaffold>(qk.team(teamKey), (old) =>
        old
          ? {
              ...old,
              estimates: {
                type: team.issueEstimationType as EstimationType,
                extended: team.issueEstimationExtended,
                allowZero: team.issueEstimationAllowZero,
                defaultEstimate: team.defaultIssueEstimate,
              },
            }
          : old,
      );
      // Progress counts unestimated issues as the default estimate.
      void qc.invalidateQueries({ queryKey: qk.team(teamKey) });
    },
  });
}

// The signed-in user's own email notification preferences, for the whole workspace.
const UserSettingsQuery = graphql(`
  query NotificationSettings {
    userSettings {
      id
      notificationCategoryPreferences {
        assignments {
          email
        }
        mentions {
          email
        }
        commentsAndReplies {
          email
        }
        statusChanges {
          email
        }
      }
    }
  }
`);

const UserSettingsUpdate = graphql(`
  mutation NotificationSettingsUpdate($id: String!, $input: UserSettingsUpdateInput!) {
    userSettingsUpdate(id: $id, input: $input) {
      userSettings {
        id
        notificationCategoryPreferences {
          assignments {
            email
          }
          mentions {
            email
          }
          commentsAndReplies {
            email
          }
          statusChanges {
            email
          }
        }
      }
    }
  }
`);
// The cache entry keeps the UserSettings id next to the preferences, because a write
// addresses userSettingsUpdate by id; callers see only the preferences (select). A
// write returns the full result, which replaces the cache directly.
type NotificationSettingsEntry = { id: string; preferences: NotificationPreferences };

async function fetchNotificationSettings(): Promise<NotificationSettingsEntry> {
  const { userSettings } = await gqlRequest(UserSettingsQuery, {});
  return {
    id: userSettings.id,
    preferences: toNotificationPreferences(userSettings.notificationCategoryPreferences),
  };
}

export function useNotificationPreferencesQuery() {
  return useQuery({
    queryKey: qk.notificationPreferences(),
    queryFn: fetchNotificationSettings,
    select: (entry: NotificationSettingsEntry) => entry.preferences,
  });
}

export function useUpdateNotificationPreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: NotificationPreferences): Promise<NotificationSettingsEntry> => {
      const id =
        qc.getQueryData<NotificationSettingsEntry>(qk.notificationPreferences())?.id ??
        (await fetchNotificationSettings()).id;
      const { userSettingsUpdate } = await gqlRequest(UserSettingsUpdate, {
        id,
        input: { notificationCategoryPreferences: toCategoryPreferencesInput(input) },
      });
      return {
        id: userSettingsUpdate.userSettings.id,
        preferences: toNotificationPreferences(
          userSettingsUpdate.userSettings.notificationCategoryPreferences,
        ),
      };
    },
    onSuccess: (entry) => qc.setQueryData(qk.notificationPreferences(), entry),
  });
}
