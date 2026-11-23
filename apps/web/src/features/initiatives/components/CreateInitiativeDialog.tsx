'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { initiativePath } from '@/utils/paths';
import Modal from '@/components/common/overlay/Modal';
import { Button } from '@/components/ui/button';
import { useCreateInitiative } from '../services/initiatives.service';
import InitiativeFormFields from './InitiativeFormFields';

// Creates an initiative from a name and a summary, then opens its page, where the
// status, owner, target date, lead team, projects and sub-initiatives are set.
export default function CreateInitiativeDialog({
  teamKey,
  onClose,
}: {
  teamKey: string;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const create = useCreateInitiative();
  const router = useRouter();

  const submit = async () => {
    if (!name.trim()) return;
    const id = await create.mutateAsync({ name: name.trim(), description: description.trim() });
    onClose();
    router.push(initiativePath(teamKey, id));
  };

  return (
    <Modal title="New initiative" onClose={onClose}>
      <InitiativeFormFields
        name={name}
        description={description}
        onName={setName}
        onDescription={setDescription}
        onSubmit={() => void submit()}
      />
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={!name.trim() || create.isPending} onClick={() => void submit()}>
          {create.isPending ? 'Creating…' : 'Create initiative'}
        </Button>
      </div>
    </Modal>
  );
}
