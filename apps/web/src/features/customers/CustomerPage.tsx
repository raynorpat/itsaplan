'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { useCustomersEnabled } from '@/hooks/useCustomersEnabled';
import { useCustomer, useCustomersSettings } from '@/services/customers.service';
import { useViewerWorkspaceQuery } from '@/services/viewer.service';
import { canSeeFeedback } from '@/utils/feedback';
import { feedbackCustomerPath, feedbackCustomersPath } from '@/utils/paths';
import CustomerDeleteDialog from './components/CustomerDeleteDialog';
import CustomerDetails from './components/CustomerDetails';
import CustomerDomains from './components/CustomerDomains';
import CustomerHeader from './components/CustomerHeader';
import CustomerIssues from './components/CustomerIssues';
import CustomerPeople from './components/CustomerPeople';
import MergeCustomerDialog from './components/MergeCustomerDialog';

// One customer (opened by slug or id): its properties and domains, changed in place,
// its people and the issues they asked for; merge it into another customer or delete
// it. Not found for guests and while Customers is off.
export default function CustomerPage() {
  const params = useParams();
  const ref = typeof params.slugId === 'string' ? decodeURIComponent(params.slugId) : '';
  const router = useRouter();
  const viewer = useViewerWorkspaceQuery();
  const settings = useCustomersSettings();
  const enabled = useCustomersEnabled();
  const visible = canSeeFeedback(viewer.data?.workspaceRole ?? null) && enabled && ref !== '';
  const query = useCustomer(ref, visible);
  const [dialog, setDialog] = useState<'merge' | 'delete' | null>(null);

  if (viewer.isPending || settings.isPending) return null;
  if (!visible || query.isError || query.data === null)
    return <p className="px-6 py-8 text-sm text-muted-foreground">Customer not found.</p>;
  if (!query.data) return <p className="px-6 py-8 text-sm text-muted-foreground">Loading…</p>;

  const customer = query.data;
  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div className="px-4 pt-3">
        <Link
          href={feedbackCustomersPath()}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-3.5" />
          Customers
        </Link>
      </div>
      <CustomerHeader
        customer={customer}
        onMerge={() => setDialog('merge')}
        onDelete={() => setDialog('delete')}
      />
      <CustomerDetails customer={customer} currency={settings.data?.revenueCurrency ?? 'USD'} />
      <CustomerDomains customer={customer} />
      <CustomerPeople customerId={customer.id} />
      <CustomerIssues customerId={customer.id} />
      {dialog === 'merge' && (
        <MergeCustomerDialog
          customer={customer}
          onClose={() => setDialog(null)}
          onMerged={(kept) => router.replace(feedbackCustomerPath(kept.slugId))}
        />
      )}
      {dialog === 'delete' && (
        <CustomerDeleteDialog
          customer={customer}
          onClose={() => setDialog(null)}
          onDeleted={() => router.replace(feedbackCustomersPath())}
        />
      )}
    </div>
  );
}
