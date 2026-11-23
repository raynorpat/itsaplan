'use client';

import { useState } from 'react';
import { cycleLabel } from '@/utils/cycles';
import Modal from '@/components/common/overlay/Modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useUpdateCycle, type CycleSummary } from '../services/cycles.service';

// A cycle's name and description. An empty name clears it, so the cycle shows as
// "Cycle N" again.
export default function CycleEditDialog({
  cycle,
  teamKey,
  teamId,
  onClose,
}: {
  cycle: CycleSummary;
  teamKey: string;
  teamId: string;
  onClose: () => void;
}) {
  const [name, setName] = useState(cycle.name ?? '');
  const [description, setDescription] = useState(cycle.description ?? '');
  const update = useUpdateCycle(teamKey, teamId);

  const submit = async () => {
    await update.mutateAsync({
      id: cycle.id,
      name: name.trim() || null,
      description: description.trim() || null,
    });
    onClose();
  };

  return (
    <Modal title="Edit cycle" teamKey={teamKey} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="edit-cycle-name">Name</Label>
          <Input
            id="edit-cycle-name"
            value={name}
            autoFocus
            placeholder={cycleLabel({ name: null, number: cycle.number })}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void submit()}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="edit-cycle-description">Description</Label>
          <Textarea
            id="edit-cycle-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={update.isPending} onClick={() => void submit()}>
            {update.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
