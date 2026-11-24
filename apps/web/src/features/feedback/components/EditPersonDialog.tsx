'use client';

import { useState } from 'react';
import Modal from '@/components/common/overlay/Modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useUpdatePerson, type Person } from '../services/people.service';

// Edits a person's name and email. An email another person already has is refused by
// the API; its message is shown by the global error toast.
export default function EditPersonDialog({
  person,
  onClose,
}: {
  person: Person;
  onClose: () => void;
}) {
  const [name, setName] = useState(person.name);
  const [email, setEmail] = useState(person.email ?? '');
  const update = useUpdatePerson();

  return (
    <Modal title="Edit person" onClose={onClose}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          update.mutate(
            { id: person.id, name: name.trim(), email: email.trim() || null },
            { onSuccess: onClose },
          );
        }}
      >
        <label className="flex flex-col gap-1 text-sm">
          Name
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Email
          <Input
            type="email"
            placeholder="Optional"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!name.trim() || update.isPending}>
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
}
