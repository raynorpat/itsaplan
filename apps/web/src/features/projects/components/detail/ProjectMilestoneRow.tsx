'use client';

import { useState } from 'react';
import { ArrowDown, ArrowUp, Flag, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import type { ProjectMilestone } from '@/types/project';
import { formatDate } from '@/utils/dates';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useDeleteMilestone, useUpdateMilestone } from '../../services/projectMilestones.service';
import ProjectMilestoneForm from './ProjectMilestoneForm';

// One milestone: its name and target date, and a menu to edit, move or delete it.
export default function ProjectMilestoneRow({
  projectId,
  milestone,
  canEdit,
  onMoveUp,
  onMoveDown,
}: {
  projectId: string;
  milestone: ProjectMilestone;
  canEdit: boolean;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const update = useUpdateMilestone(projectId);
  const remove = useDeleteMilestone(projectId);

  if (editing)
    return (
      <li>
        <ProjectMilestoneForm
          initial={milestone}
          busy={update.isPending}
          onCancel={() => setEditing(false)}
          onSave={async (input) => {
            await update.mutateAsync({ id: milestone.id, input });
            setEditing(false);
          }}
        />
      </li>
    );

  return (
    <li className="group flex items-center gap-2 py-1 text-sm">
      <Flag className="size-3.5 text-muted-foreground" />
      <span className="flex-1 truncate">{milestone.name}</span>
      {milestone.targetDate && (
        <span className="text-xs text-muted-foreground">{formatDate(milestone.targetDate)}</span>
      )}
      {canEdit && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Milestone options"
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
            {onMoveUp && (
              <DropdownMenuItem onClick={onMoveUp}>
                <ArrowUp className="size-4" />
                Move up
              </DropdownMenuItem>
            )}
            {onMoveDown && (
              <DropdownMenuItem onClick={onMoveDown}>
                <ArrowDown className="size-4" />
                Move down
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => remove.mutate(milestone.id)}>
              <Trash2 className="size-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  );
}
