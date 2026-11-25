'use client';

import { useState } from 'react';
import { closestCenter, DndContext, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Plus } from 'lucide-react';
import { useDndSensors } from '@/lib/dnd';
import { Button } from '@/components/ui/button';
import { ItemGroup } from '@/components/ui/item';
import SettingsSection from '@/components/common/page/SettingsSection';
import {
  type CustomerListItem,
  type CustomerListKind,
  useCustomerListWrites,
  useCustomerStatuses,
  useCustomerTiers,
} from '@/services/customers.service';
import { positionBetween, positionForMove } from '../utils/order';
import CustomersSettingsRow from './CustomersSettingsRow';
import CustomersSettingsItemForm, { type ItemFormValue } from './CustomersSettingsItemForm';
import CustomersSettingsDeleteDialog from './CustomersSettingsDeleteDialog';

const NEW_ITEM: ItemFormValue = { name: '', color: '#5e6ad2', description: '' };

// The customer statuses or tiers: drag to reorder, edit inline, add, delete.
export default function CustomersSettingsList({
  kind,
  title,
  description,
  canEdit,
}: {
  kind: CustomerListKind;
  title: string;
  description: string;
  canEdit: boolean;
}) {
  const statuses = useCustomerStatuses(kind === 'status');
  const tiers = useCustomerTiers(kind === 'tier');
  const items = (kind === 'status' ? statuses.data : tiers.data) ?? [];
  const { create, update } = useCustomerListWrites(kind);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<CustomerListItem | null>(null);
  const sensors = useDndSensors();
  const noun = kind === 'status' ? 'status' : 'tier';

  function onDragEnd(e: DragEndEvent) {
    const from = items.findIndex((i) => i.id === String(e.active.id));
    const to = items.findIndex((i) => i.id === String(e.over?.id));
    if (from < 0 || to < 0 || from === to) return;
    update.mutate({ id: items[from].id, input: { position: positionForMove(items, from, to) } });
  }

  async function add(value: ItemFormValue) {
    await create.mutateAsync({
      ...value,
      description: value.description || null,
      position: positionBetween(items.at(-1)?.position, undefined),
    });
    setAdding(false);
  }

  async function save(id: string, value: ItemFormValue) {
    await update.mutateAsync({ id, input: { ...value, description: value.description || null } });
    setEditingId(null);
  }

  return (
    <SettingsSection
      title={title}
      description={description}
      action={
        canEdit && (
          <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => setAdding(true)}>
            <Plus className="size-3.5" />
            New {noun}
          </Button>
        )
      }
    >
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
          <ItemGroup>
            {items.length === 0 && !adding && (
              <p className="py-2 text-sm text-muted-foreground">
                No {noun === 'status' ? 'statuses' : 'tiers'} yet.
              </p>
            )}
            {items.map((item) =>
              editingId === item.id ? (
                <CustomersSettingsItemForm
                  key={item.id}
                  initial={{
                    name: item.name,
                    color: item.color,
                    description: item.description ?? '',
                  }}
                  onSubmit={(value) => save(item.id, value)}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <CustomersSettingsRow
                  key={item.id}
                  item={item}
                  canEdit={canEdit}
                  // The last status stays: every customer has one.
                  canDelete={kind === 'tier' || items.length > 1}
                  onEdit={() => setEditingId(item.id)}
                  onDelete={() => setDeleting(item)}
                />
              ),
            )}
            {adding && (
              <CustomersSettingsItemForm
                initial={NEW_ITEM}
                onSubmit={add}
                onCancel={() => setAdding(false)}
              />
            )}
          </ItemGroup>
        </SortableContext>
      </DndContext>
      {deleting && (
        <CustomersSettingsDeleteDialog
          kind={kind}
          item={deleting}
          onClose={() => setDeleting(null)}
        />
      )}
    </SettingsSection>
  );
}
