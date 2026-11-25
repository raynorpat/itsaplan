'use client';

import { Star } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  useFavoriteFor,
  useToggleFavorite,
  type FavoriteTarget,
} from '@/services/favorites.service';

// The star on an item's page: adds the item to the viewer's favorites, or removes it.
export default function FavoriteStarButton({ target }: { target: FavoriteTarget }) {
  const favorite = useFavoriteFor(target);
  const toggle = useToggleFavorite(target);
  const label = favorite ? 'Remove from favorites' : 'Add to favorites';
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label={label}
      title={label}
      aria-pressed={favorite != null}
      disabled={toggle.isPending}
      onClick={() => toggle.mutate()}
    >
      <Star className={cn(favorite && 'fill-current text-amber-500')} />
    </Button>
  );
}
