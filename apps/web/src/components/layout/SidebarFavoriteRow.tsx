'use client';

import Link from 'next/link';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { MoreHorizontal, StarOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Favorite } from '@/services/favorites.service';
import { favoriteHref } from '@/utils/favorites';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SidebarMenuAction, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';
import { favoriteIcon } from './favoriteIcons';

// One favorite in the sidebar: its icon and name, opening the item; dragged with the
// pointer to reorder or to move into or out of a folder (the row has no keyboard
// drag: it would nest the link inside a second focusable control). Labels and people
// have no page, so their row is plain text.
export default function SidebarFavoriteRow({
  favorite,
  label,
  active,
  nested,
  onRemove,
}: {
  favorite: Favorite;
  label: string;
  active: boolean;
  nested: boolean;
  onRemove: () => void;
}) {
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: favorite.id,
  });
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
    >
      <SidebarMenuButton asChild={href != null} isActive={active} tooltip={label}>
        {href ? <Link href={href}>{content}</Link> : content}
      </SidebarMenuButton>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuAction showOnHover aria-label={`Options for ${label}`}>
            <MoreHorizontal />
          </SidebarMenuAction>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="start">
          <DropdownMenuItem onSelect={onRemove}>
            <StarOff />
            Remove from favorites
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  );
}
