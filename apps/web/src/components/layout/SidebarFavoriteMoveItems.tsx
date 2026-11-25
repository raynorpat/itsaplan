'use client';

import { ArrowDown, ArrowUp, FolderOutput } from 'lucide-react';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';

// The keyboard way to reorder favorites: Move up / Move down within the row's list,
// and Move out of folder for a folder's favorite. An action that cannot apply (the
// first row's Move up) is left out.
export default function SidebarFavoriteMoveItems({
  onMoveUp,
  onMoveDown,
  onMoveOut,
}: {
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onMoveOut?: () => void;
}) {
  return (
    <>
      {onMoveUp && (
        <DropdownMenuItem onSelect={onMoveUp}>
          <ArrowUp />
          Move up
        </DropdownMenuItem>
      )}
      {onMoveDown && (
        <DropdownMenuItem onSelect={onMoveDown}>
          <ArrowDown />
          Move down
        </DropdownMenuItem>
      )}
      {onMoveOut && (
        <DropdownMenuItem onSelect={onMoveOut}>
          <FolderOutput />
          Move out of folder
        </DropdownMenuItem>
      )}
    </>
  );
}
