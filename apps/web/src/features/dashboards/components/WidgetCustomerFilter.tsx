'use client';

import { Checkbox } from '@/components/ui/checkbox';
import { useCustomerStatuses, useCustomerTiers } from '@/services/customers.service';
import type { CustomerFilter } from '@/utils/dashboards/config';

type Key = 'statusIds' | 'tierIds';

// A customers widget's filter: the statuses and tiers it counts (none ticked: all).
export default function WidgetCustomerFilter({
  filter,
  onChange,
}: {
  filter: CustomerFilter;
  onChange: (filter: CustomerFilter) => void;
}) {
  const statuses = useCustomerStatuses().data ?? [];
  const tiers = useCustomerTiers().data ?? [];
  const toggle = (key: Key, id: string) => {
    const list = filter[key] ?? [];
    const next = list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
    onChange({ ...filter, [key]: next.length ? next : undefined });
  };
  const group = (legend: string, key: Key, items: { id: string; displayName: string }[]) =>
    items.length > 0 && (
      <fieldset className="flex flex-wrap gap-3 text-sm">
        <legend className="mb-1 text-xs text-muted-foreground">{legend}</legend>
        {items.map((item) => (
          <label key={item.id} className="flex items-center gap-1.5">
            <Checkbox
              checked={(filter[key] ?? []).includes(item.id)}
              onCheckedChange={() => toggle(key, item.id)}
            />
            {item.displayName}
          </label>
        ))}
      </fieldset>
    );
  return (
    <div className="grid gap-2">
      {group('Status', 'statusIds', statuses)}
      {group('Tier', 'tierIds', tiers)}
    </div>
  );
}
