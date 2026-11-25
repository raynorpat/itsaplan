'use client';

import { Fragment } from 'react';
import { usePathname } from 'next/navigation';
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  type SortingStrategy,
} from '@dnd-kit/sortable';
import { FolderPlus } from 'lucide-react';
import { useDndSensors } from '@/lib/dnd';
import { suppressNextClick } from '@/utils/dragClick';
import { useCollapsedFavoriteFolders } from '@/hooks/useCollapsedFavoriteFolders';
import { useIsPhone } from '@/hooks/useIsPhone';
import {
  moveTo,
  useCreateFolder,
  useDashboardNames,
  useDeleteFavorite,
  useDeleteFolder,
  useFavorites,
  useMoveFavorite,
  useRenameFolder,
  type Favorite,
} from '@/services/favorites.service';
import {
  dropTarget,
  dropZone,
  favoriteHref,
  favoriteLabel,
  favoriteTree,
  holdsStill,
  outOfFolderTarget,
  stepTarget,
  type DropTarget,
} from '@/utils/favorites';
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
// folders in their own order, dragged to reorder and into or out of folders (or moved
// from each row's menu). Hidden while the person has none.
export default function SidebarFavorites() {
  const pathname = usePathname();
  const favorites = useFavorites();
  const list = favorites.data ?? [];
  const dashboards = useDashboardNames(list.some((f) => f.type === 'dashboard'));
  const sensors = useDndSensors();
  const draggable = !useIsPhone();
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

  const moveTarget = (id: string) => (target: DropTarget | null) =>
    target ? () => move.mutate({ id, ...moveTo(target) }) : undefined;

  const shownTypes = shown.map((f) => f.type);
  const strategy: SortingStrategy = (args) =>
    holdsStill(shownTypes, args.activeIndex, args.overIndex)
      ? null
      : verticalListSortingStrategy(args);

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    suppressNextClick();
    if (!over) return;
    const dragged = active.rect.current.translated;
    const zone = dragged ? dropZone(over.rect, dragged.top + dragged.height / 2) : 'into';
    const target = dropTarget(tree, String(active.id), String(over.id), zone);
    if (target) move.mutate({ id: String(active.id), ...moveTo(target) });
  };

  const row = (f: Favorite, nested: boolean) => {
    const href = favoriteHref(f);
    const to = moveTarget(f.id);
    return (
      <SidebarFavoriteRow
        key={f.id}
        favorite={f}
        label={favoriteLabel(f, dashboards)}
        active={href != null && href.split(/[?#]/)[0] === pathname}
        nested={nested}
        draggable={draggable}
        onRemove={() => remove.mutate(f.id)}
        onMoveUp={to(stepTarget(tree, f.id, 'up'))}
        onMoveDown={to(stepTarget(tree, f.id, 'down'))}
        onMoveOut={to(outOfFolderTarget(tree, f.id))}
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
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
          onDragCancel={() => suppressNextClick()}
        >
          <SortableContext items={shown.map((f) => f.id)} strategy={strategy}>
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
                      draggable={draggable}
                      onToggle={() => toggle(f.id)}
                      onRename={(folderName) => renameFolder.mutate({ id: f.id, folderName })}
                      onDelete={() => deleteFolder.mutate(f.id)}
                      onMoveUp={moveTarget(f.id)(stepTarget(tree, f.id, 'up'))}
                      onMoveDown={moveTarget(f.id)(stepTarget(tree, f.id, 'down'))}
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
