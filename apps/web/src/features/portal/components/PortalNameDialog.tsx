'use client';

import { useState } from 'react';
import Modal from '@/components/common/overlay/Modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useUpdateDisplayName, type PortalVisitor } from '../services/portal.service';

// The name other visitors and the team see on the portal.
export default function PortalNameDialog({
  slug,
  visitor,
  onClose,
}: {
  slug: string;
  visitor: PortalVisitor;
  onClose: () => void;
}) {
  const [name, setName] = useState(visitor.displayName);
  const update = useUpdateDisplayName(slug);
  return (
    <Modal title="Your name" description="Shown next to your votes and comments." onClose={onClose}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) update.mutate(name.trim(), { onSuccess: onClose });
        }}
      >
        <Input aria-label="Name" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        <div className="flex justify-end">
          <Button type="submit" disabled={!name.trim() || update.isPending}>
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
}
