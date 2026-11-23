'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Archive, ArchiveRestore, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { initiativesPath } from '@/utils/paths';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import ConfirmDialog from '@/components/common/overlay/ConfirmDialog';
import {
  useArchiveInitiative,
  useDeleteInitiative,
  useUnarchiveInitiative,
  type InitiativeDetail,
} from '../services/initiatives.service';
import EditInitiativeDialog from './EditInitiativeDialog';

// The initiative's menu: edit its name and summary, archive or unarchive it, or
// delete it (to the trash) after a confirmation, which returns to the list.
export default function InitiativeActions({
  initiative,
  teamKey,
}: {
  initiative: InitiativeDetail;
  teamKey: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const archive = useArchiveInitiative(initiative.id);
  const unarchive = useUnarchiveInitiative(initiative.id);
  const remove = useDeleteInitiative(initiative.id);
  const archived = initiative.archivedAt != null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Initiative options"
            className="rounded p-0.5 text-muted-foreground/60 hover:text-foreground"
          >
            <MoreHorizontal className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setEditing(true)}>
            <Pencil className="size-4" />
            Edit
          </DropdownMenuItem>
          {archived ? (
            <DropdownMenuItem onClick={() => unarchive.mutate()}>
              <ArchiveRestore className="size-4" />
              Unarchive
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={() => archive.mutate()}>
              <Archive className="size-4" />
              Archive
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => setConfirming(true)}>
            <Trash2 className="size-4" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {editing && (
        <EditInitiativeDialog initiative={initiative} onClose={() => setEditing(false)} />
      )}
      {confirming && (
        <ConfirmDialog
          title="Delete initiative"
          confirmLabel="Delete"
          onConfirm={async () => {
            await remove.mutateAsync();
            router.push(initiativesPath(teamKey));
          }}
          onClose={() => setConfirming(false)}
        >
          <p className="text-sm text-muted-foreground">
            The initiative moves to the trash and leaves the list. Its projects are not changed.
          </p>
        </ConfirmDialog>
      )}
    </>
  );
}
