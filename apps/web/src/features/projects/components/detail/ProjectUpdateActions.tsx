'use client';

import { toast } from 'sonner';
import { Archive, MoreHorizontal, Pencil } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  useArchiveProjectUpdate,
  useUnarchiveProjectUpdate,
} from '../../services/projectUpdates.service';

// The author's menu on an update: edit it, or archive it (Linear's delete) with Undo.
export default function ProjectUpdateActions({
  projectId,
  updateId,
  onEdit,
}: {
  projectId: string;
  updateId: string;
  onEdit: () => void;
}) {
  const archive = useArchiveProjectUpdate(projectId);
  const unarchive = useUnarchiveProjectUpdate(projectId);

  const remove = async () => {
    await archive.mutateAsync(updateId);
    toast.success('Update archived.', {
      action: { label: 'Undo', onClick: () => unarchive.mutate(updateId) },
    });
  };

  return (
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
        <DropdownMenuItem variant="destructive" onClick={() => void remove()}>
          <Archive className="size-4" />
          Archive
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
