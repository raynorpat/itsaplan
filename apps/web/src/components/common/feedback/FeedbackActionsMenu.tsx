'use client';

import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

// The ⋯ menu on a feedback item: edit the quote, mark it important or not, move it to
// another issue, delete it.
export default function FeedbackActionsMenu({
  important,
  onEdit,
  onToggleImportant,
  onMove,
  onDelete,
}: {
  important: boolean;
  onEdit: () => void;
  onToggleImportant: () => void;
  onMove: () => void;
  onDelete: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-6 text-muted-foreground hover:text-foreground"
          aria-label="Feedback actions"
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onEdit}>Edit quote</DropdownMenuItem>
        <DropdownMenuItem onSelect={onToggleImportant}>
          {important ? 'Mark as not important' : 'Mark as important'}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onMove}>Move to issue…</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={onDelete}>
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
