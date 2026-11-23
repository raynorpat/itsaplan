'use client';

import { useState } from 'react';
import Modal from '@/components/common/overlay/Modal';
import { Button } from '@/components/ui/button';
import { useUpdateInitiative, type InitiativeDetail } from '../services/initiatives.service';
import InitiativeFormFields from './InitiativeFormFields';

// Renames the initiative and edits its short summary (Linear's description).
export default function EditInitiativeDialog({
  initiative,
  onClose,
}: {
  initiative: InitiativeDetail;
  onClose: () => void;
}) {
  const [name, setName] = useState(initiative.name);
  const [description, setDescription] = useState(initiative.description);
  const update = useUpdateInitiative(initiative.id);

  const save = async () => {
    if (!name.trim()) return;
    await update.mutateAsync({ name: name.trim(), description: description.trim() });
    onClose();
  };

  return (
    <Modal title="Edit initiative" onClose={onClose}>
      <InitiativeFormFields
        name={name}
        description={description}
        onName={setName}
        onDescription={setDescription}
        onSubmit={() => void save()}
      />
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={!name.trim() || update.isPending} onClick={() => void save()}>
          Save
        </Button>
      </div>
    </Modal>
  );
}
