import type { Pipeline } from '@/services/releases.service';
import { stageOrder } from '@/utils/releases';
import ReleaseStageBadge from '../ReleaseStageBadge';
import PipelineReleaseCard from './PipelineReleaseCard';

// A scheduled pipeline's releases as columns, one per stage in workflow order. A
// frozen stage says so under its name.
export default function PipelineStageBoard({
  pipeline,
  teamKey,
}: {
  pipeline: Pipeline;
  teamKey: string;
}) {
  return (
    <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto px-6 pb-6">
      {stageOrder(pipeline.stages).map((stage) => {
        const releases = pipeline.releases.filter((r) => r.stage.id === stage.id);
        return (
          <section key={stage.id} className="flex w-72 shrink-0 flex-col gap-2">
            <h2 className="flex items-center justify-between py-1">
              <ReleaseStageBadge stage={stage} />
              <span className="text-xs text-muted-foreground tabular-nums">
                {stage.frozen ? 'Frozen · ' : ''}
                {releases.length}
              </span>
            </h2>
            {releases.map((r) => (
              <PipelineReleaseCard
                key={r.id}
                release={r}
                teamKey={teamKey}
                pipelineSlug={pipeline.slugId}
              />
            ))}
          </section>
        );
      })}
    </div>
  );
}
