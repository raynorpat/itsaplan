'use client';

import { Star, StarOff } from 'lucide-react';
import { ContextMenuItem } from '@/components/ui/context-menu';
import {
  useFavoriteFor,
  useToggleFavorite,
  type FavoriteTarget,
} from '@/services/favorites.service';

// "Add to favorites" / "Remove from favorites" in a context menu.
export default function FavoriteMenuItem({ target }: { target: FavoriteTarget }) {
  const favorite = useFavoriteFor(target);
  const toggle = useToggleFavorite(target);
  return (
    <ContextMenuItem onSelect={() => toggle.mutate()}>
      {favorite ? <StarOff /> : <Star />}
      {favorite ? 'Remove from favorites' : 'Add to favorites'}
    </ContextMenuItem>
  );
}
