'use client';

import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

// The "…" menu on a comment: edit, resolve or unresolve the thread, delete. Only
// the actions the viewer may take are passed in; with none, the menu is not shown.

export default function CommentActionsMenu({
  onEdit,
  onResolve,
  onDelete,
  resolved,
}: {
  onEdit?: () => void;
  onResolve?: () => void;
  onDelete?: () => void;
  resolved?: boolean;
}) {
  if (!onEdit && !onResolve && !onDelete) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-6 text-muted-foreground hover:text-foreground"
          aria-label="Comment actions"
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {onEdit && <DropdownMenuItem onSelect={onEdit}>Edit</DropdownMenuItem>}
        {onResolve && (
          <DropdownMenuItem onSelect={onResolve}>
            {resolved ? 'Unresolve thread' : 'Resolve thread'}
          </DropdownMenuItem>
        )}
        {onDelete && (
          <DropdownMenuItem className="text-destructive" onSelect={onDelete}>
            Delete
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
