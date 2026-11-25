'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Modal from '@/components/common/overlay/Modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useReleaseWrites } from '@/services/releases.service';
import { releasePath } from '@/utils/paths';

// A new release in a scheduled pipeline: a name and an optional target date. It opens
// the new release's page.
export default function PipelineNewReleaseDialog({
  pipelineId,
  pipelineSlug,
  teamKey,
  onClose,
}: {
  pipelineId: string;
  pipelineSlug: string;
  teamKey: string;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const { create } = useReleaseWrites();
  const router = useRouter();

  const submit = async () => {
    if (create.isPending || !name.trim()) return;
    const release = await create.mutateAsync({
      pipelineId,
      name: name.trim(),
      targetDate: targetDate || null,
    });
    onClose();
    router.push(releasePath(teamKey, pipelineSlug, release.slugId));
  };

  return (
    <Modal title="New release" teamKey={teamKey} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-release-name">Name</Label>
          <Input
            id="new-release-name"
            value={name}
            autoFocus
            placeholder="v2.3"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void submit()}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-release-target">Target date</Label>
          <Input
            id="new-release-target"
            type="date"
            value={targetDate}
            onChange={(e) => setTargetDate(e.target.value)}
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={create.isPending || !name.trim()} onClick={() => void submit()}>
            {create.isPending ? 'Creating…' : 'Create release'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
