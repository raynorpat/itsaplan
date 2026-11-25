import { useState } from 'react';
import { Archive, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import ConfirmDialog from '@/components/common/overlay/ConfirmDialog';
import {
  usePipelineSettingsWrites,
  type PipelineSettings,
} from '../services/releasesSettings.service';
import PipelineStages from './PipelineStages';
import PipelineAccessKeys from './PipelineAccessKeys';

// One pipeline in team settings: its name, type and teams, Edit and Archive, its
// stages (scheduled pipelines only) and its CI access keys.
export default function PipelineSettingsCard({
  pipeline,
  canEdit,
  canManageKeys,
  onEdit,
}: {
  pipeline: PipelineSettings;
  canEdit: boolean;
  canManageKeys: boolean;
  onEdit: () => void;
}) {
  const { archivePipeline } = usePipelineSettingsWrites();
  const [archiving, setArchiving] = useState(false);
  const facts = [
    pipeline.type === 'scheduled' ? 'Scheduled' : 'Continuous',
    pipeline.isProduction ? 'Production' : 'Not production',
    pipeline.teams.map((t) => t.name).join(', '),
  ];

  return (
    <section className="flex flex-col gap-4 rounded-lg border p-4" aria-label={pipeline.name}>
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="truncate text-sm font-medium">{pipeline.name}</h2>
          <p className="text-xs text-muted-foreground">{facts.join(' · ')}</p>
        </div>
        {canEdit && (
          <div className="flex shrink-0 items-center gap-1">
            <Button variant="ghost" size="sm" className="gap-1.5" onClick={onEdit}>
              <Pencil className="size-3.5" aria-hidden />
              Edit
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5"
              onClick={() => setArchiving(true)}
            >
              <Archive className="size-3.5" aria-hidden />
              Archive
            </Button>
          </div>
        )}
      </header>
      {pipeline.type === 'scheduled' && <PipelineStages pipeline={pipeline} canEdit={canEdit} />}
      <PipelineAccessKeys pipelineId={pipeline.id} canManage={canManageKeys} />
      {archiving && (
        <ConfirmDialog
          title={`Archive ${pipeline.name}?`}
          confirmLabel="Archive"
          onConfirm={async () => {
            await archivePipeline.mutateAsync(pipeline.id);
          }}
          onClose={() => setArchiving(false)}
        >
          Its releases stay readable, and its access keys stop working.
        </ConfirmDialog>
      )}
    </section>
  );
}
