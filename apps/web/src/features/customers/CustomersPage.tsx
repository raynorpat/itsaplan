'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Search } from 'lucide-react';
import FeedbackNav from '@/components/common/page/FeedbackNav';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useCustomersEnabled } from '@/hooks/useCustomersEnabled';
import {
  useCustomerPeopleCounts,
  useCustomers,
  useCustomersSettings,
} from '@/services/customers.service';
import { useViewerWorkspaceQuery } from '@/services/viewer.service';
import { canSeeFeedback } from '@/utils/feedback';
import { feedbackCustomerPath } from '@/utils/paths';
import CustomerDialog from './components/CustomerDialog';
import CustomersList from './components/CustomersList';
import { sortCustomers, type CustomerSortKey, type SortDir } from './utils/customers';

// Feedback → Customers: the companies the people who give feedback work for, searched
// by name and sorted by name, requests or revenue. Not found for guests and while
// Customers is off.
export default function CustomersPage() {
  const router = useRouter();
  const viewer = useViewerWorkspaceQuery();
  const settings = useCustomersSettings();
  const enabled = useCustomersEnabled();
  const visible = canSeeFeedback(viewer.data?.workspaceRole ?? null) && enabled;
  const query = useCustomers(undefined, visible);
  const people = useCustomerPeopleCounts(visible);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<{ key: CustomerSortKey; dir: SortDir }>({
    key: 'name',
    dir: 'asc',
  });
  const [creating, setCreating] = useState(false);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    const found = (query.data ?? []).filter((c) => c.name.toLowerCase().includes(term));
    return sortCustomers(
      found.map((c) => ({
        ...c,
        requests: c.approximateNeedCount,
        people: people.data?.[c.id] ?? 0,
        revenue: c.revenue ?? null,
      })),
      sort.key,
      sort.dir,
    );
  }, [query.data, people.data, search, sort]);

  if (viewer.isPending || settings.isPending) return null;
  if (!visible) return <p className="px-6 py-8 text-sm text-muted-foreground">Page not found.</p>;

  const onSort = (key: CustomerSortKey) =>
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'name' ? 'asc' : 'desc' },
    );

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <FeedbackNav />
      <div className="flex items-center justify-between gap-4 px-4 py-3">
        <h1 className="text-lg font-semibold">Customers</h1>
        <div className="flex items-center gap-2">
          <div className="relative w-64">
            <Search className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Search customers"
              placeholder="Search by name"
              className="h-8 pl-7"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Button size="sm" className="h-8 gap-1.5" onClick={() => setCreating(true)}>
            <Plus className="size-3.5" />
            New customer
          </Button>
        </div>
      </div>
      {query.isPending ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">
          {search.trim()
            ? 'No customer matches this search.'
            : 'No customers yet. Add one, and people with its email domains are grouped under it.'}
        </p>
      ) : (
        <CustomersList
          customers={rows}
          currency={settings.data?.revenueCurrency ?? 'USD'}
          sort={sort}
          onSort={onSort}
        />
      )}
      {creating && (
        <CustomerDialog
          onClose={() => setCreating(false)}
          onCreated={(c) => router.push(feedbackCustomerPath(c.slugId))}
        />
      )}
    </div>
  );
}
