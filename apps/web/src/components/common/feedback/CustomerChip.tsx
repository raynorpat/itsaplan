'use client';

import Link from 'next/link';
import { Building2 } from 'lucide-react';
import { feedbackCustomerPath } from '@/utils/paths';

// The customer a feedback item or a person belongs to, linking to the customer's page
// (which opens by id or slug). The API gives no customer while Customers is off, so
// nothing shows then.
export default function CustomerChip({
  customer,
}: {
  customer: { id: string; name: string } | null;
}) {
  if (!customer) return null;
  return (
    <Link
      href={feedbackCustomerPath(customer.id)}
      className="inline-flex max-w-40 shrink-0 items-center gap-1 rounded border px-1 text-xs text-muted-foreground hover:text-foreground"
    >
      <Building2 className="size-3" aria-hidden />
      <span className="truncate">{customer.name}</span>
    </Link>
  );
}
