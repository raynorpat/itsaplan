'use client';

import { useShell } from '@/context/shellContext';
import { useTeamPipelines } from '@/services/releases.service';
import PipelineRow from './components/pipelines/PipelineRow';
import PipelinesEmpty from './components/pipelines/PipelinesEmpty';

// A team's release pipelines, each with its latest release.
export default function PipelinesPage() {
  const { team } = useShell();
  const pipelines = useTeamPipelines(team?.team.id ?? null);
  if (!team) return null;
  const teamKey = team.team.key;
  const list = pipelines.data ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="flex items-center justify-between px-6 py-4">
        <h1 className="text-lg font-semibold">Releases</h1>
      </div>
      {pipelines.isLoading && <p className="px-6 text-sm text-muted-foreground">Loading…</p>}
      {pipelines.isError && (
        <p className="px-6 text-sm text-destructive">{pipelines.error.message}</p>
      )}
      {pipelines.isSuccess && list.length === 0 && <PipelinesEmpty teamKey={teamKey} />}
      {list.length > 0 && (
        <div className="flex flex-col border-t">
          {list.map((p) => (
            <PipelineRow key={p.id} pipeline={p} teamKey={teamKey} />
          ))}
        </div>
      )}
    </div>
  );
}
