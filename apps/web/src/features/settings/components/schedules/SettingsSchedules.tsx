import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { AgentSchedule, AgentScheduleInput, TeamDetail } from '@/lib/api';
import { aiAgentsPath } from '@/utils/paths';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/common/page/EmptyState';
import {
  useAgentSchedules,
  useCreateAgentSchedule,
  useDeleteAgentSchedule,
  useRunAgentSchedule,
  useUpdateAgentSchedule,
} from '@/services/agentSchedules.service';
import { useInternalAgents } from '../../hooks/useInternalAgents';
import { useSettingsCan } from '../../context/settingsPermission';
import SettingsConfirmDeleteDialog from '../crud/SettingsConfirmDeleteDialog';
import { SettingsScheduleDialog } from './SettingsScheduleDialog';
import { SettingsScheduleRunsSheet } from './SettingsScheduleRunsSheet';
import { SettingsSchedulesTable } from './SettingsSchedulesTable';

export default function SettingsSchedules({
  team,
  requestNew,
  onNewHandled,
}: {
  team: TeamDetail;
  requestNew: boolean;
  onNewHandled: () => void;
}) {
  const teamKey = team.team.key;
  const can = useSettingsCan();
  const schedulesQuery = useAgentSchedules(teamKey);
  const agentsQuery = useInternalAgents(teamKey);
  const schedules = schedulesQuery.data ?? [];
  const agents = agentsQuery.agents;
  const createSchedule = useCreateAgentSchedule(teamKey);
  const updateSchedule = useUpdateAgentSchedule(teamKey);
  const deleteSchedule = useDeleteAgentSchedule(teamKey);
  const runSchedule = useRunAgentSchedule(teamKey);
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [deleting, setDeleting] = useState<AgentSchedule | null>(null);
  const [history, setHistory] = useState<AgentSchedule | null>(null);

  // The "New schedule" button lives in the page header; opening is signalled here.
  useEffect(() => {
    if (!requestNew) return;
    setEditing('new');
    onNewHandled();
  }, [requestNew, onNewHandled]);

  if (agentsQuery.isError || schedulesQuery.isError) {
    return (
      <EmptyState
        title="Couldn't load schedules"
        description="Check your connection and try again."
      >
        <Button
          size="sm"
          variant="outline"
          onClick={() => void Promise.all([agentsQuery.refetch(), schedulesQuery.refetch()])}
        >
          Try again
        </Button>
      </EmptyState>
    );
  }

  if (agentsQuery.isLoading || schedulesQuery.isLoading) {
    return (
      <div
        className="flex min-h-[320px] items-center justify-center text-sm text-muted-foreground"
        aria-live="polite"
      >
        Loading schedules…
      </div>
    );
  }

  if (agents.length === 0) {
    return (
      <EmptyState
        title="No agents to schedule"
        description="A schedule runs a task for one of your internal agents."
      >
        {can('edit') && (
          <Button size="sm" asChild>
            <Link href={aiAgentsPath(teamKey)}>Create an agent</Link>
          </Button>
        )}
      </EmptyState>
    );
  }

  const saving = createSchedule.isPending || updateSchedule.isPending;
  const editingSchedule =
    editing != null && editing !== 'new'
      ? schedules.find((schedule) => schedule.id === editing)
      : undefined;
  const showEditor = editing === 'new' || editingSchedule != null;

  async function saveSchedule(value: AgentScheduleInput) {
    if (editing === 'new') {
      await createSchedule.mutateAsync(value);
    } else if (editing != null && editing !== 'new') {
      await updateSchedule.mutateAsync({ id: editing, patch: value });
    }
    setEditing(null);
  }

  return (
    <>
      {schedules.length === 0 ? (
        <EmptyState
          title="No schedules yet"
          description="Pick an agent, a task, and how often it runs."
        />
      ) : (
        <div className="space-y-4">
          <SettingsSchedulesTable
            schedules={schedules}
            runningId={runSchedule.isPending ? (runSchedule.variables ?? null) : null}
            onToggle={(schedule) =>
              updateSchedule.mutate({
                id: schedule.id,
                patch: { status: schedule.status === 'active' ? 'paused' : 'active' },
              })
            }
            onRun={(scheduleId) => runSchedule.mutate(scheduleId)}
            onHistory={setHistory}
            onEdit={setEditing}
            onDelete={setDeleting}
          />
        </div>
      )}

      {showEditor && (
        <SettingsScheduleDialog
          key={editingSchedule?.id ?? 'new'}
          teamKey={teamKey}
          agents={agents}
          initial={editingSchedule}
          saving={saving}
          onSave={saveSchedule}
          onClose={() => setEditing(null)}
        />
      )}

      {deleting && (
        <SettingsConfirmDeleteDialog
          title="Delete schedule"
          confirmLabel="Delete schedule"
          message={
            <>
              The schedule <span className="font-medium">{deleting.name}</span> and its run history
              will be removed. This cannot be undone.
            </>
          }
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await deleteSchedule.mutateAsync(deleting.id);
            setDeleting(null);
          }}
        />
      )}
      <SettingsScheduleRunsSheet
        teamKey={teamKey}
        schedule={history}
        onClose={() => setHistory(null)}
      />
    </>
  );
}
