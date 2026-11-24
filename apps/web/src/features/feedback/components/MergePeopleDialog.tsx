'use client';

import { useState } from 'react';
import ConfirmDialog from '@/components/common/overlay/ConfirmDialog';
import Modal from '@/components/common/overlay/Modal';
import FeedbackRequesterPicker from '@/components/common/feedback/FeedbackRequesterPicker';
import type { FeedbackRequester } from '@/utils/feedback';
import { useMergePeople, type Person } from '../services/people.service';
import { mergeConfirmText } from '../utils/people';

// Merges this person into another one (owners and admins): pick the person to keep,
// then confirm. `onMerged` receives the kept person's id.
export default function MergePeopleDialog({
  person,
  onClose,
  onMerged,
}: {
  person: Person;
  onClose: () => void;
  onMerged: (keptId: string) => void;
}) {
  const [into, setInto] = useState<FeedbackRequester | null>(null);
  const merge = useMergePeople();

  if (!into) {
    return (
      <Modal title={`Merge ${person.name} into…`} onClose={onClose}>
        <FeedbackRequesterPicker excludeId={person.id} onPick={setInto} />
      </Modal>
    );
  }

  return (
    <ConfirmDialog
      title="Merge people"
      confirmLabel="Merge"
      onClose={onClose}
      onConfirm={async () => {
        const kept = await merge.mutateAsync({ fromId: person.id, intoId: into.id });
        onMerged(kept.id);
      }}
    >
      <p className="text-sm text-muted-foreground">{mergeConfirmText(person, into)}</p>
    </ConfirmDialog>
  );
}
