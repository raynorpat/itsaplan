'use client';

import { useState } from 'react';
import { Archive, MoreHorizontal, Pencil } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import ConfirmDialog from '@/components/common/overlay/ConfirmDialog';
import { useArchiveInitiativeUpdate } from '../services/initiativeUpdates.service';

// The author's menu on an initiative update: edit it, or archive it after a
// confirmation (Linear has no delete for initiative updates).
export default function InitiativeUpdateActions({
  initiativeId,
  updateId,
  onEdit,
}: {
  initiativeId: string;
  updateId: string;
  onEdit: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const archive = useArchiveInitiativeUpdate(initiativeId);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Update options"
            className="rounded p-0.5 text-muted-foreground/60 hover:text-foreground"
          >
            <MoreHorizontal className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onEdit}>
            <Pencil className="size-4" />
            Edit
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setConfirming(true)}>
            <Archive className="size-4" />
            Archive
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {confirming && (
        <ConfirmDialog
          title="Archive update"
          confirmLabel="Archive"
          onConfirm={async () => {
            await archive.mutateAsync(updateId);
          }}
          onClose={() => setConfirming(false)}
        >
          <p className="text-sm text-muted-foreground">
            The update leaves the list. The initiative&apos;s health becomes the previous
            update&apos;s.
          </p>
        </ConfirmDialog>
      )}
    </>
  );
}
