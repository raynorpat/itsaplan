'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { Project } from '@/types/project';
import { projectsPath } from '@/utils/paths';
import { usePermissions } from '@/hooks/usePermissions';
import { useDeleteProject, useRestoreProject } from '@/services/projects.service';
import ConfirmDialog from '@/components/common/overlay/ConfirmDialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import EditProjectDialog from './EditProjectDialog';

// The project's overflow menu: Edit and Delete. Delete moves the project to the trash
// (restorable for 30 days) and returns to the projects list, with Undo in the toast.
// A deleted project's page offers Restore in its banner instead.
export default function ProjectActions({
  project,
  teamKey,
}: {
  project: Project;
  teamKey: string;
}) {
  const { can } = usePermissions();
  const del = useDeleteProject(teamKey);
  const restore = useRestoreProject(teamKey);
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const canEdit = can('projects', 'edit');
  const canDelete = can('projects', 'delete') && project.archivedAt == null;
  if (!canEdit && !canDelete) return null;

  // A failed delete throws to ConfirmDialog, which keeps the dialog open for a retry;
  // the global mutation handler shows the error.
  const remove = async () => {
    await del.mutateAsync(project.id);
    toast.success('Project moved to the trash.', {
      action: canEdit
        ? {
            label: 'Undo',
            onClick: () => restore.mutate(project.id),
          }
        : undefined,
    });
    router.push(projectsPath(teamKey));
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Project options"
            className="rounded p-0.5 text-muted-foreground/60 hover:text-foreground"
          >
            <MoreHorizontal className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {canEdit && (
            <DropdownMenuItem onClick={() => setEditing(true)}>
              <Pencil className="size-4" />
              Edit
            </DropdownMenuItem>
          )}
          {canEdit && canDelete && <DropdownMenuSeparator />}
          {canDelete && (
            <DropdownMenuItem variant="destructive" onSelect={() => setConfirming(true)}>
              <Trash2 className="size-4" />
              Delete
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {editing && (
        <EditProjectDialog project={project} teamKey={teamKey} onClose={() => setEditing(false)} />
      )}
      {confirming && (
        <ConfirmDialog
          title="Delete project"
          confirmLabel="Delete"
          onConfirm={remove}
          onClose={() => setConfirming(false)}
        >
          <div className="text-sm text-muted-foreground">
            Move <strong>{project.name}</strong> to the trash? It can be restored for 30 days, then
            it is deleted for good. Its issues keep existing.
          </div>
        </ConfirmDialog>
      )}
    </>
  );
}
