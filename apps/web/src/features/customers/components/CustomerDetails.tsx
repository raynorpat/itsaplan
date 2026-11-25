'use client';

import {
  useCustomerStatuses,
  useCustomerTiers,
  useUpdateCustomer,
  type Customer,
  type CustomerInput,
} from '@/services/customers.service';
import { parseWholeNumber } from '../utils/customers';
import CustomerListPick from './CustomerListPick';
import CustomerOwnerPick from './CustomerOwnerPick';
import CustomerTextField from './CustomerTextField';

// A customer's properties, each changed in place: status, tier, owner, revenue (in the
// workspace currency) and size.
export default function CustomerDetails({
  customer,
  currency,
}: {
  customer: Customer;
  currency: string;
}) {
  const statuses = useCustomerStatuses().data ?? [];
  const tiers = useCustomerTiers().data ?? [];
  const update = useUpdateCustomer();
  const save = (input: CustomerInput) => update.mutate({ id: customer.id, input });

  return (
    <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
      <CustomerListPick
        label="Status"
        items={statuses}
        value={customer.status.id}
        onChange={(id) => id && save({ statusId: id })}
      />
      <CustomerListPick
        label="Tier"
        items={tiers}
        value={customer.tier?.id ?? null}
        onChange={(id) => save({ tierId: id })}
        noneLabel="No tier"
      />
      <CustomerOwnerPick
        value={customer.owner?.id ?? null}
        onChange={(id) => save({ ownerId: id })}
      />
      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        Revenue ({currency})
        <CustomerTextField
          key={`revenue-${customer.revenue ?? ''}`}
          label="Revenue"
          className="w-32"
          value={customer.revenue == null ? '' : String(customer.revenue)}
          parse={parseWholeNumber}
          onSave={(revenue) => save({ revenue })}
        />
      </label>
      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        Size
        <CustomerTextField
          key={`size-${customer.size ?? ''}`}
          label="Size"
          className="w-24"
          value={customer.size == null ? '' : String(customer.size)}
          parse={parseWholeNumber}
          onSave={(size) => save({ size })}
        />
      </label>
    </div>
  );
}
