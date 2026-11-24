'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Archive, ArchiveRestore, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { Project } from '@/types/project';
import { projectsPath } from '@/utils/paths';
import { usePermissions } from '@/hooks/usePermissions';
import { useDeleteProject, useSetProjectArchived } from '@/services/projects.service';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import EditProjectDialog from './EditProjectDialog';

// The project's overflow menu: Edit, Archive or Unarchive, Delete. Deleting returns to
// the projects list; an archived project stays open with its banner.
export default function ProjectActions({
  project,
  teamKey,
}: {
  project: Project;
  teamKey: string;
}) {
  const { can } = usePermissions();
  const del = useDeleteProject(teamKey);
  const setArchived = useSetProjectArchived(teamKey);
  const router = useRouter();
  const [editing, setEditing] = useState(false);

  const canEdit = can('projects', 'edit');
  const canDelete = can('projects', 'delete');
  if (!canEdit && !canDelete) return null;

  const archived = project.archivedAt != null;
  const toggleArchived = () =>
    setArchived.mutate(
      { id: project.id, archived: !archived },
      {
        onSuccess: () => toast.success(archived ? 'Project unarchived.' : 'Project archived.'),
        onError: (err) => toast.error(err.message || 'Could not change the project.'),
      },
    );

  const remove = async () => {
    await del.mutateAsync(project.id);
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
          {canEdit && (
            <DropdownMenuItem disabled={setArchived.isPending} onClick={toggleArchived}>
              {archived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}
              {archived ? 'Unarchive' : 'Archive'}
            </DropdownMenuItem>
          )}
          {canEdit && canDelete && <DropdownMenuSeparator />}
          {canDelete && (
            <DropdownMenuItem variant="destructive" onClick={() => void remove()}>
              <Trash2 className="size-4" />
              Delete
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {editing && (
        <EditProjectDialog project={project} teamKey={teamKey} onClose={() => setEditing(false)} />
      )}
    </>
  );
}
