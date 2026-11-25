'use client';

import { Fragment } from 'react';
import { usePathname } from 'next/navigation';
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { FolderPlus } from 'lucide-react';
import { useDndSensors } from '@/lib/dnd';
import { useCollapsedFavoriteFolders } from '@/hooks/useCollapsedFavoriteFolders';
import {
  useCreateFolder,
  useDashboardNames,
  useDeleteFavorite,
  useDeleteFolder,
  useFavorites,
  useMoveFavorite,
  useRenameFolder,
  type Favorite,
} from '@/services/favorites.service';
import { dropTarget, favoriteHref, favoriteLabel, favoriteTree } from '@/utils/favorites';
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
} from '@/components/ui/sidebar';
import SidebarFavoriteFolder from './SidebarFavoriteFolder';
import SidebarFavoriteRow from './SidebarFavoriteRow';

// The person's Favorites at the top of the sidebar, as in Linear: favorites and
// folders in their own order, dragged to reorder and into or out of folders. Hidden
// while the person has none.
export default function SidebarFavorites() {
  const pathname = usePathname();
  const favorites = useFavorites();
  const list = favorites.data ?? [];
  const dashboards = useDashboardNames(list.some((f) => f.type === 'dashboard'));
  const sensors = useDndSensors();
  const { collapsed, toggle } = useCollapsedFavoriteFolders();
  const move = useMoveFavorite();
  const remove = useDeleteFavorite();
  const createFolder = useCreateFolder();
  const renameFolder = useRenameFolder();
  const deleteFolder = useDeleteFolder();

  if (list.length === 0) return null;
  const tree = favoriteTree(list);
  const shown = tree.flatMap((n) =>
    collapsed.has(n.favorite.id) ? [n.favorite] : [n.favorite, ...n.children],
  );

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over) return;
    const target = dropTarget(tree, String(active.id), String(over.id));
    if (target) move.mutate({ id: String(active.id), ...target });
  };

  const row = (f: Favorite, nested: boolean) => {
    const href = favoriteHref(f);
    return (
      <SidebarFavoriteRow
        key={f.id}
        favorite={f}
        label={favoriteLabel(f, dashboards)}
        active={href != null && href.split('?')[0] === pathname}
        nested={nested}
        onRemove={() => remove.mutate(f.id)}
      />
    );
  };

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Favorites</SidebarGroupLabel>
      <SidebarGroupAction
        title="New folder"
        aria-label="New folder"
        onClick={() => createFolder.mutate('New folder')}
      >
        <FolderPlus />
      </SidebarGroupAction>
      <SidebarGroupContent>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={shown.map((f) => f.id)} strategy={verticalListSortingStrategy}>
            <SidebarMenu>
              {tree.map((node) => {
                const f = node.favorite;
                if (f.type !== 'folder') return row(f, false);
                const open = !collapsed.has(f.id);
                return (
                  <Fragment key={f.id}>
                    <SidebarFavoriteFolder
                      folder={f}
                      open={open}
                      onToggle={() => toggle(f.id)}
                      onRename={(folderName) => renameFolder.mutate({ id: f.id, folderName })}
                      onDelete={() =>
                        deleteFolder.mutate({
                          folderId: f.id,
                          children: node.children.map((c) => c.id),
                          topLevelOrders: tree.map((n) => n.favorite.sortOrder),
                        })
                      }
                    />
                    {open && node.children.map((c) => row(c, true))}
                  </Fragment>
                );
              })}
            </SidebarMenu>
          </SortableContext>
        </DndContext>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
