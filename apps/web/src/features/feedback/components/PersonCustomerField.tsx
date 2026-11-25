'use client';

import { useState } from 'react';
import { Building2 } from 'lucide-react';
import CustomerChip from '@/components/common/feedback/CustomerChip';
import CustomerPicker from '@/components/common/feedback/CustomerPicker';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useCustomersEnabled } from '@/hooks/useCustomersEnabled';
import { useSetPersonCustomer } from '@/services/customers.service';
import type { Person } from '../services/people.service';

// The person's customer: from their email domain or set by hand. Picking one sets it by
// hand; "Use email domain" clears the pick so the domain decides again. Hidden while
// Customers is off.
export default function PersonCustomerField({ person }: { person: Person }) {
  const enabled = useCustomersEnabled();
  const setCustomer = useSetPersonCustomer();
  const [open, setOpen] = useState(false);
  if (!enabled) return null;

  const customer = person.customer;
  return (
    <div className="flex items-center gap-2 px-4 pb-2 text-sm">
      <span className="text-muted-foreground">Customer</span>
      {customer ? (
        <>
          <CustomerChip customer={customer} />
          <span className="text-xs text-muted-foreground">
            {customer.source === 'manual' ? 'Set by hand' : 'From email domain'}
          </span>
        </>
      ) : (
        <span className="text-xs text-muted-foreground">None</span>
      )}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs">
            <Building2 className="size-3.5" />
            {customer ? 'Change' : 'Pick customer'}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-0" align="start">
          <CustomerPicker
            excludeId={customer?.id}
            onPick={(c) =>
              setCustomer.mutate(
                { id: person.id, customerId: c.id },
                { onSuccess: () => setOpen(false) },
              )
            }
          />
        </PopoverContent>
      </Popover>
      {customer?.source === 'manual' && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          disabled={setCustomer.isPending}
          onClick={() => setCustomer.mutate({ id: person.id, customerId: null })}
        >
          Use email domain
        </Button>
      )}
    </div>
  );
}
