'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useUpdateCustomer, type Customer } from '@/services/customers.service';
import { parseDomains } from '../utils/customers';

// The email domains that group people under the customer: remove one, or type new ones
// and press Enter. The API refuses a public or taken domain (shown by the error toast).
export default function CustomerDomains({ customer }: { customer: Customer }) {
  const update = useUpdateCustomer();
  const [draft, setDraft] = useState('');
  const save = (domains: string[]) => update.mutate({ id: customer.id, input: { domains } });

  function add() {
    const added = parseDomains(draft).filter((d) => !customer.domains.includes(d));
    if (added.length === 0) return;
    update.mutate(
      { id: customer.id, input: { domains: [...customer.domains, ...added] } },
      { onSuccess: () => setDraft('') },
    );
  }

  return (
    <section className="px-4 pb-4">
      <h2 className="pb-1.5 text-sm font-medium">Email domains</h2>
      <div className="flex flex-wrap items-center gap-1.5">
        {customer.domains.map((d) => (
          <span
            key={d}
            className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs"
          >
            {d}
            <button
              type="button"
              aria-label={`Remove ${d}`}
              className="rounded text-muted-foreground hover:text-foreground"
              onClick={() => save(customer.domains.filter((x) => x !== d))}
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        <Input
          aria-label="Add email domains"
          placeholder={customer.domains.length ? 'Add a domain' : 'acme.com'}
          className="h-7 w-48 text-xs"
          value={draft}
          disabled={update.isPending}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
      </div>
      <p className="pt-1.5 text-xs text-muted-foreground">
        People whose email address is at one of these domains belong to this customer.
      </p>
    </section>
  );
}
