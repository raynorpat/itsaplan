import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { stageOrder } from '@/utils/releases';
import {
  usePipelineSettingsWrites,
  type PipelineSettings,
} from '../services/releasesSettings.service';
import { movedPosition, newStagePosition } from '../utils/pipelineForm';
import PipelineStageRow from './PipelineStageRow';

// A scheduled pipeline's stages in workflow order. Every stage can be renamed,
// recoloured and frozen; the in-progress stages can also be moved among themselves,
// archived, and added to (the planned, completed and canceled stages stay one each).
export default function PipelineStages({
  pipeline,
  canEdit,
}: {
  pipeline: PipelineSettings;
  canEdit: boolean;
}) {
  const { createStage, updateStage, archiveStage } = usePipelineSettingsWrites();
  const stages = stageOrder(pipeline.stages);
  const started = stages.filter((s) => s.type === 'started');
  const startedPositions = started.map((s) => s.position);

  const move = (id: string, by: -1 | 1) => {
    const from = started.findIndex((s) => s.id === id);
    const to = from + by;
    if (to < 0 || to >= started.length) return;
    updateStage.mutate({ id, input: { position: movedPosition(startedPositions, from, to) } });
  };

  return (
    <div className="flex flex-col gap-1.5">
      <h3 className="text-xs font-medium text-muted-foreground">Stages</h3>
      <ul className="flex flex-col divide-y rounded-md border">
        {stages.map((stage) => {
          const index = started.findIndex((s) => s.id === stage.id);
          return (
            <PipelineStageRow
              key={stage.id}
              stage={stage}
              canEdit={canEdit}
              onChange={(input) => updateStage.mutate({ id: stage.id, input })}
              onMoveUp={index > 0 ? () => move(stage.id, -1) : undefined}
              onMoveDown={
                index >= 0 && index < started.length - 1 ? () => move(stage.id, 1) : undefined
              }
              onArchive={
                index >= 0 && started.length > 1 ? () => archiveStage.mutate(stage.id) : undefined
              }
            />
          );
        })}
      </ul>
      {canEdit && (
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 self-start"
          onClick={() =>
            createStage.mutate({
              pipelineId: pipeline.id,
              name: 'New stage',
              color: '#f2c94c',
              position: newStagePosition(startedPositions),
            })
          }
        >
          <Plus className="size-3.5" aria-hidden />
          Add stage
        </Button>
      )}
    </div>
  );
}
