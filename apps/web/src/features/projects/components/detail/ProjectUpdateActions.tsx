'use client';

import { useState } from 'react';
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import ConfirmDialog from '@/components/common/overlay/ConfirmDialog';
import { useDeleteProjectUpdate } from '../../services/projectUpdates.service';

// The author's menu on an update: edit it, or delete it after a confirmation.
export default function ProjectUpdateActions({
  projectId,
  updateId,
  onEdit,
}: {
  projectId: string;
  updateId: string;
  onEdit: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const remove = useDeleteProjectUpdate(projectId);

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
          <DropdownMenuItem variant="destructive" onClick={() => setConfirming(true)}>
            <Trash2 className="size-4" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {confirming && (
        <ConfirmDialog
          title="Delete update"
          confirmLabel="Delete"
          onConfirm={async () => {
            await remove.mutateAsync(updateId);
          }}
          onClose={() => setConfirming(false)}
        >
          <p className="text-sm text-muted-foreground">
            The update and its comments are deleted. The project&apos;s health becomes the previous
            update&apos;s.
          </p>
        </ConfirmDialog>
      )}
    </>
  );
}
