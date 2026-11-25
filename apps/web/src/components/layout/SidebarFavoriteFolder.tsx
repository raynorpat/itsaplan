'use client';

import { useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ChevronRight, Folder, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Favorite } from '@/services/favorites.service';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SidebarMenuAction, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';
import SidebarFavoriteMoveItems from './SidebarFavoriteMoveItems';

// A favorites folder: its name folds its favorites open and closed. A favorite
// dropped on the middle of the row goes into the folder, on its top or bottom edge
// above or below it. Its menu (the "…" button or a right-click) renames it in place,
// moves it up or down, and deletes it, keeping its favorites (moved to the top level).
export default function SidebarFavoriteFolder({
  folder,
  open,
  draggable,
  onToggle,
  onRename,
  onDelete,
  onMoveUp,
  onMoveDown,
}: {
  folder: Favorite;
  open: boolean;
  draggable: boolean;
  onToggle: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}) {
  const { listeners, setNodeRef, transform, transition, isDragging, isOver } = useSortable({
    id: folder.id,
    disabled: !draggable,
  });
  const [editing, setEditing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const name = folder.folderName ?? 'Folder';

  const finish = (value: string) => {
    setEditing(false);
    const next = value.trim();
    if (next && next !== name) onRename(next);
  };

  return (
    <SidebarMenuItem
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(isDragging && 'opacity-40')}
      {...(editing ? {} : listeners)}
      onContextMenu={(e) => {
        if (editing) return;
        e.preventDefault();
        setMenuOpen(true);
      }}
    >
      {editing ? (
        <input
          autoFocus
          aria-label="Folder name"
          defaultValue={name}
          maxLength={255}
          className="h-8 w-full rounded-md border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onBlur={(e) => finish(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') finish(e.currentTarget.value);
            if (e.key === 'Escape') setEditing(false);
          }}
        />
      ) : (
        <SidebarMenuButton
          tooltip={name}
          aria-expanded={open}
          onClick={onToggle}
          className={cn(isOver && 'bg-sidebar-accent')}
        >
          <Folder />
          <span className="truncate">{name}</span>
          <ChevronRight
            className={cn('size-3.5 shrink-0 transition-transform', open && 'rotate-90')}
          />
        </SidebarMenuButton>
      )}
      {!editing && (
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <SidebarMenuAction showOnHover aria-label={`Options for ${name}`}>
              <MoreHorizontal />
            </SidebarMenuAction>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="start">
            <DropdownMenuItem onSelect={() => setEditing(true)}>
              <Pencil />
              Rename
            </DropdownMenuItem>
            <SidebarFavoriteMoveItems onMoveUp={onMoveUp} onMoveDown={onMoveDown} />
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onDelete}>
              <Trash2 />
              Delete folder
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </SidebarMenuItem>
  );
}
