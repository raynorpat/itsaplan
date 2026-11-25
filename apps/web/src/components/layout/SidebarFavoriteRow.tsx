'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { MoreHorizontal, StarOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useDragClickGuard } from '@/hooks/useDragClickGuard';
import type { Favorite } from '@/services/favorites.service';
import { favoriteHref } from '@/utils/favorites';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SidebarMenuAction, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';
import { favoriteIcon } from './favoriteIcons';
import SidebarFavoriteMoveItems from './SidebarFavoriteMoveItems';

// One favorite in the sidebar: its icon and name, opening the item. Dragged with the
// pointer to reorder or to move into or out of a folder (not on phones, where a touch
// scrolls); its menu (the "…" button or a right-click) moves it with the keyboard and
// removes it. Labels and people have no page, so their row is plain text.
export default function SidebarFavoriteRow({
  favorite,
  label,
  active,
  nested,
  draggable,
  onRemove,
  onMoveUp,
  onMoveDown,
  onMoveOut,
}: {
  favorite: Favorite;
  label: string;
  active: boolean;
  nested: boolean;
  draggable: boolean;
  onRemove: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onMoveOut?: () => void;
}) {
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: favorite.id,
    disabled: !draggable,
  });
  const guard = useDragClickGuard();
  const [menuOpen, setMenuOpen] = useState(false);
  const Icon = favoriteIcon(favorite.type);
  const href = favoriteHref(favorite);
  const color = favorite.label?.color ?? favorite.projectLabel?.color;
  const content = (
    <>
      <Icon style={color ? { color } : undefined} />
      <span className="truncate">{label}</span>
    </>
  );
  return (
    <SidebarMenuItem
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(nested && 'pl-4', isDragging && 'opacity-40')}
      {...listeners}
      onPointerDown={(e) => {
        guard.onPointerDown(e);
        listeners?.onPointerDown?.(e);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenuOpen(true);
      }}
    >
      <SidebarMenuButton asChild isActive={active} tooltip={label}>
        {href ? (
          <Link
            href={href}
            onClick={(e) => {
              if (!guard.isClick(e)) e.preventDefault();
            }}
          >
            {content}
          </Link>
        ) : (
          <span>{content}</span>
        )}
      </SidebarMenuButton>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <SidebarMenuAction showOnHover aria-label={`Options for ${label}`}>
            <MoreHorizontal />
          </SidebarMenuAction>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="start">
          <SidebarFavoriteMoveItems
            onMoveUp={onMoveUp}
            onMoveDown={onMoveDown}
            onMoveOut={onMoveOut}
          />
          {(onMoveUp || onMoveDown || onMoveOut) && <DropdownMenuSeparator />}
          <DropdownMenuItem onSelect={onRemove}>
            <StarOff />
            Remove from favorites
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  );
}
