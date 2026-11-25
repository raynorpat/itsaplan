'use client';

import { Merge, Trash2 } from 'lucide-react';
import Avatar from '@/components/common/Avatar';
import { Button } from '@/components/ui/button';
import { useUpdateCustomer, type Customer } from '@/services/customers.service';
import CustomerTextField from './CustomerTextField';

// The customer's logo and name (renamed in place), with Merge into… and Delete.
export default function CustomerHeader({
  customer,
  onMerge,
  onDelete,
}: {
  customer: Customer;
  onMerge: () => void;
  onDelete: () => void;
}) {
  const update = useUpdateCustomer();
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <Avatar name={customer.name} image={customer.logoUrl} className="size-9 rounded-md text-sm" />
      <CustomerTextField
        key={customer.name}
        label="Customer name"
        className="h-9 max-w-md flex-1 border-transparent text-lg font-semibold shadow-none hover:border-input"
        value={customer.name}
        parse={(text) => (text.trim() ? text.trim() : undefined)}
        onSave={(name) => update.mutate({ id: customer.id, input: { name } })}
      />
      <span className="flex-1" />
      <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={onMerge}>
        <Merge className="size-3.5" />
        Merge into…
      </Button>
      <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={onDelete}>
        <Trash2 className="size-3.5" />
        Delete
      </Button>
    </div>
  );
}
