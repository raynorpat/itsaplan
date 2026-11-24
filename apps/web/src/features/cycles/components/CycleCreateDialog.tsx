'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import Modal from '@/components/common/overlay/Modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCreateCycle } from '../services/cycles.service';
import { newCycleInput } from '../utils/cycleActions';

// A cycle made by hand: an optional name and its first and last day. The API
// refuses dates that overlap another cycle; its message is shown.
export default function CycleCreateDialog({
  teamKey,
  teamId,
  onClose,
}: {
  teamKey: string;
  teamId: string;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const create = useCreateCycle(teamKey);

  const submit = async () => {
    if (create.isPending) return;
    const input = newCycleInput({ name, startsAt, endsAt }, teamId);
    if ('error' in input) {
      setError(input.error);
      return;
    }
    setError(null);
    try {
      await create.mutateAsync(input);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create the cycle.');
    }
  };

  return (
    <Modal title="New cycle" teamKey={teamKey} onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-cycle-name">Name</Label>
          <Input
            id="new-cycle-name"
            value={name}
            autoFocus
            placeholder="Optional"
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-cycle-start">Start date</Label>
            <Input
              id="new-cycle-start"
              type="date"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-cycle-end">End date</Label>
            <Input
              id="new-cycle-end"
              type="date"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
            />
          </div>
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? 'Creating…' : 'Create cycle'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
