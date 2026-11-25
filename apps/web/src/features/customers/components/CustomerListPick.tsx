'use client';

import { colorDot } from '@/components/common/fields/colorDot';
import { Pill } from '@/components/common/fields/Pill';
import PopoverPick, { type PickItem } from '@/components/common/fields/PopoverPick';
import type { CustomerListItem } from '@/services/customers.service';

// Picks a customer's status or tier from the workspace's list. With `noneLabel` the
// value may be cleared (tiers); statuses always have one.
export default function CustomerListPick({
  label,
  items,
  value,
  onChange,
  noneLabel,
  readOnly,
}: {
  label: string;
  items: CustomerListItem[];
  value: string | null;
  onChange: (id: string | null) => void;
  noneLabel?: string;
  readOnly?: boolean;
}) {
  const current = items.find((i) => i.id === value) ?? null;
  const pickItems: PickItem[] = items.map((i) => ({
    key: i.id,
    search: i.displayName,
    icon: colorDot(i.color),
    label: i.displayName,
    selected: i.id === value,
    onSelect: () => onChange(i.id),
  }));
  if (noneLabel)
    pickItems.unshift({
      key: '__none',
      search: noneLabel,
      icon: null,
      label: noneLabel,
      selected: value === null,
      onSelect: () => onChange(null),
    });
  return (
    <PopoverPick
      readOnly={readOnly}
      inputPlaceholder={`Set ${label.toLowerCase()}…`}
      emptyText="Nothing found."
      items={pickItems}
      trigger={
        <Pill active={current !== null} aria-label={label}>
          {current ? colorDot(current.color) : null}
          {current?.displayName ?? noneLabel ?? label}
        </Pill>
      }
    />
  );
}
