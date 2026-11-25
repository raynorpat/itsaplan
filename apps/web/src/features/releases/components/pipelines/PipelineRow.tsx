import Link from 'next/link';
import type { PipelineSummary } from '@/services/releases.service';
import { pipelinePath } from '@/utils/paths';
import { releaseLabel } from '@/utils/releases';
import ReleaseStageBadge from '../ReleaseStageBadge';

// One pipeline on the team's Releases page: its name and kind, its latest release and
// how many releases it has, linking to the pipeline's page.
export default function PipelineRow({
  pipeline,
  teamKey,
}: {
  pipeline: PipelineSummary;
  teamKey: string;
}) {
  const latest = pipeline.latestRelease;
  return (
    <Link
      href={pipelinePath(teamKey, pipeline.slugId)}
      className="flex items-center gap-4 border-b px-6 py-2.5 text-sm last:border-b-0 hover:bg-muted/50"
    >
      <span className="min-w-0 flex-1 truncate font-medium">{pipeline.name}</span>
      <span className="w-24 shrink-0 text-xs text-muted-foreground">
        {pipeline.type === 'scheduled' ? 'Scheduled' : 'Continuous'}
        {pipeline.isProduction ? '' : ' · Staging'}
      </span>
      <span className="flex w-56 shrink-0 items-center gap-2 truncate text-xs text-muted-foreground">
        {latest ? (
          <>
            <span className="truncate">{releaseLabel(latest)}</span>
            <ReleaseStageBadge stage={latest.stage} />
          </>
        ) : (
          'No releases yet'
        )}
      </span>
      <span className="w-20 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
        {pipeline.approximateReleaseCount}{' '}
        {pipeline.approximateReleaseCount === 1 ? 'release' : 'releases'}
      </span>
    </Link>
  );
}
