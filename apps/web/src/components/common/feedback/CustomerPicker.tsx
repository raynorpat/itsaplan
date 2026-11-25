'use client';

import Avatar from '@/components/common/Avatar';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { useCustomers, type Customer } from '@/services/customers.service';

// Finds a customer by name or domain. `excludeId` leaves one customer out (merging).
export default function CustomerPicker({
  onPick,
  excludeId,
}: {
  onPick: (customer: Customer) => void;
  excludeId?: string;
}) {
  const customers = (useCustomers().data ?? []).filter((c) => c.id !== excludeId);
  return (
    <Command className="rounded-md border">
      <CommandInput placeholder="Search customers…" />
      <CommandList>
        <CommandEmpty>No customer found.</CommandEmpty>
        <CommandGroup>
          {customers.map((c) => (
            <CommandItem
              key={c.id}
              value={`${c.name} ${c.domains.join(' ')} ${c.id}`}
              onSelect={() => onPick(c)}
            >
              <Avatar name={c.name} image={c.logoUrl} className="rounded-md" />
              <span className="truncate">{c.name}</span>
              {c.domains[0] && (
                <span className="truncate text-xs text-muted-foreground">{c.domains[0]}</span>
              )}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  );
}
