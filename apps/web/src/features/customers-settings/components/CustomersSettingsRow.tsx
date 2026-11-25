'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Pencil, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { colorDot } from '@/components/common/fields/colorDot';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item';
import type { CustomerListItem } from '@/services/customers.service';

// One sortable status or tier. The grip is the drag handle, so the buttons stay
// clickable.
export default function CustomersSettingsRow({
  item,
  canEdit,
  canDelete,
  onEdit,
  onDelete,
}: {
  item: CustomerListItem;
  canEdit: boolean;
  canDelete: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    disabled: !canEdit,
  });
  return (
    <Item
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      size="sm"
      className={cn(
        'border-0 border-b border-border py-2 last:border-b-0 hover:bg-accent/50',
        isDragging && 'opacity-40',
      )}
    >
      {canEdit ? (
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="-ml-1 cursor-grab touch-none text-muted-foreground/50 group-hover/item:text-muted-foreground"
          title="Drag to reorder"
        >
          <GripVertical className="size-4" />
        </button>
      ) : (
        <span className="-ml-1 size-4" />
      )}
      <ItemMedia>{colorDot(item.color)}</ItemMedia>
      <ItemContent>
        <ItemTitle>{item.displayName}</ItemTitle>
        {item.description && <ItemDescription>{item.description}</ItemDescription>}
      </ItemContent>
      {canEdit && (
        <ItemActions className="opacity-0 group-focus-within/item:opacity-100 group-hover/item:opacity-100">
          <Button
            variant="ghost"
            size="icon"
            className="size-6 text-muted-foreground hover:text-foreground"
            title="Edit"
            onClick={onEdit}
          >
            <Pencil className="size-4" />
          </Button>
          {canDelete && (
            <Button
              variant="ghost"
              size="icon"
              className="size-6 text-muted-foreground hover:text-destructive"
              title="Delete"
              onClick={onDelete}
            >
              <Trash2 className="size-4" />
            </Button>
          )}
        </ItemActions>
      )}
    </Item>
  );
}
