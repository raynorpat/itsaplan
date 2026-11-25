'use client';

import { toast } from 'sonner';
import { Archive, Mail, MoreHorizontal, Pencil } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  useArchiveProjectUpdate,
  useShareProjectUpdate,
  useUnarchiveProjectUpdate,
} from '../../services/projectUpdates.service';

// The menu on an update: the author edits it or archives it (Linear's delete) with Undo;
// the author or an admin sends it to requesters when it was not sent yet.
export default function ProjectUpdateActions({
  projectId,
  updateId,
  canEdit,
  canSend,
  onEdit,
}: {
  projectId: string;
  updateId: string;
  canEdit: boolean;
  canSend: boolean;
  onEdit: () => void;
}) {
  const archive = useArchiveProjectUpdate(projectId);
  const unarchive = useUnarchiveProjectUpdate(projectId);
  const share = useShareProjectUpdate(projectId);

  const send = async () => {
    await share.mutateAsync(updateId);
    toast.success('The update will be emailed to requesters');
  };

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
        {canSend && (
          <DropdownMenuItem disabled={share.isPending} onClick={() => void send()}>
            <Mail className="size-4" />
            Send to requesters
          </DropdownMenuItem>
        )}
        {canEdit && (
          <>
            <DropdownMenuItem onClick={onEdit}>
              <Pencil className="size-4" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={() => void remove()}>
              <Archive className="size-4" />
              Archive
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
