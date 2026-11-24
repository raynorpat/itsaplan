import { useDraggable } from '@dnd-kit/core';
import { Archive, ArchiveRestore, GripVertical } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import type { Label as LabelRow } from '@/types/team';
import { colorDot } from '@/components/common/fields/colorDot';
import { SettingsRow } from '../crud/SettingsRow';
import { useSettingsCan } from '../../context/settingsPermission';

// `draggable` means the team has groups to move a label between.
export function SettingsDraggableLabelRow({
  label,
  draggable,
  meta,
  onEdit,
  onDelete,
  onRetire,
  onRestore,
}: {
  label: LabelRow;
  draggable: boolean;
  meta?: string;
  onEdit: () => void;
  onDelete: () => void;
  // Retire on an active label, Restore on a retired one.
  onRetire?: () => void;
  onRestore?: () => void;
}) {
  // Moving a label between groups is a labels edit; disable dragging and hide the
  // grip without it.
  const canEdit = useSettingsCan()('edit');
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({
    id: label.id,
    disabled: !canEdit,
  });
  const handle =
    draggable && canEdit ? (
      <button
        ref={setNodeRef}
        {...listeners}
        {...attributes}
        title="Drag to a group"
        aria-label="Drag label"
        className="flex size-6 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground active:cursor-grabbing"
      >
        <GripVertical className="size-4" />
      </button>
    ) : undefined;
  let retireAction: ReactNode;
  if (onRestore)
    retireAction = (
      <RowIconButton title="Restore label" onClick={onRestore}>
        <ArchiveRestore className="size-4" />
      </RowIconButton>
    );
  else if (onRetire)
    retireAction = (
      <RowIconButton title="Retire label" onClick={onRetire}>
        <Archive className="size-4" />
      </RowIconButton>
    );
  return (
    <SettingsRow
      className="h-11"
      handle={handle}
      dimmed={isDragging}
      media={colorDot(label.color)}
      title={label.name}
      meta={meta}
      editTitle="Edit label"
      deleteTitle="Delete label"
      onEdit={onEdit}
      onDelete={onDelete}
      extraAction={canEdit ? retireAction : undefined}
    />
  );
}

function RowIconButton({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-6 text-muted-foreground hover:text-foreground"
      title={title}
      aria-label={title}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}
