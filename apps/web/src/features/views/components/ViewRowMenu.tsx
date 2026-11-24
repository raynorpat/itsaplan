import { useState } from 'react';
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import type { View } from '@/types/team';
import { useDeleteView } from '@/services/views.service';
import ConfirmDialog from '@/components/common/overlay/ConfirmDialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import RenameViewDialog from './RenameViewDialog';

// A view row's menu: rename and delete, each shown only when the viewer may do it
// (the same rights as the view tabs).
export default function ViewRowMenu({
  view,
  canEdit,
  canDelete,
}: {
  view: View;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const [dialog, setDialog] = useState<'rename' | 'delete' | null>(null);
  const remove = useDeleteView(view.teamKey);
  if (!canEdit && !canDelete) return null;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Actions for ${view.name}`}
          className="rounded p-0.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-accent focus-visible:opacity-100 data-[state=open]:opacity-100"
        >
          <MoreHorizontal className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          {canEdit && (
            <DropdownMenuItem onSelect={() => setDialog('rename')}>
              <Pencil className="size-3.5" /> Rename
            </DropdownMenuItem>
          )}
          {canDelete && (
            <DropdownMenuItem variant="destructive" onSelect={() => setDialog('delete')}>
              <Trash2 className="size-3.5" /> Delete
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {dialog === 'rename' && <RenameViewDialog view={view} onClose={() => setDialog(null)} />}
      {dialog === 'delete' && (
        <ConfirmDialog
          title="Delete view"
          confirmLabel="Delete"
          onConfirm={() => remove.mutateAsync(view.id).then(() => setDialog(null))}
          onClose={() => setDialog(null)}
        >
          <p className="text-sm text-muted-foreground">
            “{view.name}” is removed for everyone who uses it. Its issues are not changed.
          </p>
        </ConfirmDialog>
      )}
    </>
  );
}
