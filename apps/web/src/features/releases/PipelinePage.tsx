'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { Plus } from 'lucide-react';
import { useShell } from '@/context/shellContext';
import { Button } from '@/components/ui/button';
import { PIPELINE_RELEASE_LIMIT, usePipeline } from '@/services/releases.service';
import PipelineNewReleaseDialog from './components/pipeline/PipelineNewReleaseDialog';
import PipelineReleaseRow from './components/pipeline/PipelineReleaseRow';
import PipelineStageBoard from './components/pipeline/PipelineStageBoard';
import ReleaseNotFound from './components/ReleaseNotFound';
import { useCanEditReleases } from './hooks/useCanEditReleases';

const param = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

// One release pipeline: a continuous pipeline's releases newest first, or a scheduled
// pipeline's releases on a board by stage with New release.
export default function PipelinePage() {
  const { team } = useShell();
  const params = useParams();
  const slug = param(params.pipelineSlug);
  const query = usePipeline(slug);
  const canEdit = useCanEditReleases();
  const [creating, setCreating] = useState(false);

  if (!team) return null;
  const pipeline = query.data;
  if (!pipeline) return <ReleaseNotFound loading={query.isLoading} what="Pipeline" />;
  const teamKey = team.team.key;
  const scheduled = pipeline.type === 'scheduled';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex min-w-0 flex-col">
          <h1 className="truncate text-lg font-semibold">{pipeline.name}</h1>
          <p className="text-xs text-muted-foreground">
            {scheduled ? 'Scheduled releases' : 'Continuous releases'}
            {pipeline.isProduction ? ' · Production' : ''}
          </p>
        </div>
        {scheduled && canEdit && (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus aria-hidden />
            New release
          </Button>
        )}
      </div>
      {scheduled ? (
        <PipelineStageBoard pipeline={pipeline} teamKey={teamKey} />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto border-t">
          {pipeline.releases.length === 0 ? (
            <p className="px-6 py-8 text-sm text-muted-foreground">
              No releases yet. Releases appear here when CI syncs a deploy.
            </p>
          ) : (
            pipeline.releases.map((r) => (
              <PipelineReleaseRow
                key={r.id}
                release={r}
                teamKey={teamKey}
                pipelineSlug={pipeline.slugId}
              />
            ))
          )}
          {pipeline.releasesCapped && (
            <p className="px-6 py-3 text-xs text-muted-foreground">
              Showing the newest {PIPELINE_RELEASE_LIMIT} releases.
            </p>
          )}
        </div>
      )}
      {creating && (
        <PipelineNewReleaseDialog
          pipelineId={pipeline.id}
          pipelineSlug={pipeline.slugId}
          teamKey={teamKey}
          onClose={() => setCreating(false)}
        />
      )}
    </div>
  );
}
