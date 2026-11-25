'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import DatePill from '@/components/common/fields/DatePill';
import ConfirmDialog from '@/components/common/overlay/ConfirmDialog';
import { useReleaseWrites, type ReleaseDetail } from '@/services/releases.service';
import { pipelinePath } from '@/utils/paths';
import { releaseLabel } from '@/utils/releases';
import ReleaseProgress from './ReleaseProgress';
import ReleaseStageSelect from './ReleaseStageSelect';

// The release's name (saved on blur), its pipeline, version and commit, stage, dates,
// progress, and Complete / Cancel / Archive. Without edit rights everything is read
// only.
export default function ReleaseHeader({
  release,
  teamKey,
  canEdit,
}: {
  release: ReleaseDetail;
  teamKey: string;
  canEdit: boolean;
}) {
  const { update, archive } = useReleaseWrites();
  const [name, setName] = useState(release.name);
  const [archiving, setArchiving] = useState(false);
  const stageOf = (type: string) => release.pipeline.stages.find((s) => s.type === type);
  const done = release.stage.type === 'completed' || release.stage.type === 'canceled';
  const moveTo = (stageId: string | undefined) =>
    stageId && update.mutate({ id: release.id, input: { stageId } });

  return (
    <div className="flex flex-col gap-3 border-b px-6 py-4">
      <Link
        href={pipelinePath(teamKey, release.pipeline.slugId)}
        className="text-xs text-muted-foreground hover:underline"
      >
        {release.pipeline.name}
      </Link>
      <div className="flex items-center gap-2">
        {canEdit ? (
          <Input
            aria-label="Release name"
            value={name}
            placeholder={releaseLabel({ name: '', version: release.version })}
            className="h-9 flex-1 border-transparent px-1 text-lg font-semibold shadow-none hover:border-input"
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              const next = name.trim();
              if (next && next !== release.name)
                update.mutate({ id: release.id, input: { name: next } });
              else setName(release.name);
            }}
          />
        ) : (
          <h1 className="flex-1 truncate text-lg font-semibold">{releaseLabel(release)}</h1>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        {release.version && <span>Version {release.version}</span>}
        {release.commitSha && <span className="font-mono">{release.commitSha.slice(0, 7)}</span>}
        <ReleaseStageSelect
          stages={release.pipeline.stages}
          value={release.stage}
          disabled={!canEdit}
          onChange={(stageId) => moveTo(stageId)}
        />
        <DatePill
          value={release.startDate}
          placeholder="Start date"
          readOnly={!canEdit}
          onChange={(v) => update.mutate({ id: release.id, input: { startDate: v } })}
        />
        <DatePill
          value={release.targetDate}
          placeholder="Target date"
          readOnly={!canEdit}
          onChange={(v) => update.mutate({ id: release.id, input: { targetDate: v } })}
        />
        <ReleaseProgress completed={release.progress.completed} total={release.progress.total} />
      </div>
      {canEdit && (
        <div className="flex gap-2">
          {!done && (
            <Button size="sm" onClick={() => moveTo(stageOf('completed')?.id)}>
              Complete release
            </Button>
          )}
          {!done && (
            <Button size="sm" variant="ghost" onClick={() => moveTo(stageOf('canceled')?.id)}>
              Cancel release
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setArchiving(true)}>
            Archive
          </Button>
        </div>
      )}
      {archiving && (
        <ConfirmDialog
          title="Archive this release?"
          confirmLabel="Archive"
          onConfirm={async () => {
            await archive.mutateAsync(release.id);
          }}
          onClose={() => setArchiving(false)}
        >
          It leaves the pipeline&apos;s lists. Its issues keep their history.
        </ConfirmDialog>
      )}
    </div>
  );
}
