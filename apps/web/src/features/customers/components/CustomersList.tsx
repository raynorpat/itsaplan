'use client';

import Link from 'next/link';
import Avatar from '@/components/common/Avatar';
import { colorDot } from '@/components/common/fields/colorDot';
import type { Customer } from '@/services/customers.service';
import { feedbackCustomerPath } from '@/utils/paths';
import { formatRevenue, type CustomerSortKey, type SortDir } from '../utils/customers';
import CustomerSortHeader from './CustomerSortHeader';

// The Customers list: logo and name, status, tier, owner, people, the issues their people
// asked for and revenue, one row each, with sortable name, people, issues and revenue
// columns.
export default function CustomersList({
  customers,
  currency,
  sort,
  onSort,
}: {
  customers: (Customer & { people: number })[];
  currency: string;
  sort: { key: CustomerSortKey; dir: SortDir };
  onSort: (key: CustomerSortKey) => void;
}) {
  return (
    <div>
      <div className="flex items-center gap-3 border-y px-4 py-1.5">
        <CustomerSortHeader
          label="Name"
          column="name"
          sort={sort}
          onSort={onSort}
          className="flex-1"
        />
        <span className="w-28 shrink-0 text-xs text-muted-foreground">Status</span>
        <span className="w-28 shrink-0 text-xs text-muted-foreground">Tier</span>
        <span className="w-32 shrink-0 text-xs text-muted-foreground">Owner</span>
        <span className="flex w-20 shrink-0 justify-end">
          <CustomerSortHeader label="People" column="people" sort={sort} onSort={onSort} />
        </span>
        <span className="flex w-28 shrink-0 justify-end">
          <CustomerSortHeader
            label="Issues requested"
            column="requests"
            sort={sort}
            onSort={onSort}
          />
        </span>
        <span className="flex w-20 shrink-0 justify-end">
          <CustomerSortHeader label="Revenue" column="revenue" sort={sort} onSort={onSort} />
        </span>
      </div>
      <ul className="divide-y border-b">
        {customers.map((c) => (
          <li key={c.id}>
            <Link
              href={feedbackCustomerPath(c.slugId)}
              className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none"
            >
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <Avatar name={c.name} image={c.logoUrl} className="rounded-md" />
                <span className="truncate font-medium">{c.name}</span>
              </span>
              <span className="flex w-28 shrink-0 items-center gap-1.5 truncate text-muted-foreground">
                {colorDot(c.status.color)}
                {c.status.displayName}
              </span>
              <span className="flex w-28 shrink-0 items-center gap-1.5 truncate text-muted-foreground">
                {c.tier ? colorDot(c.tier.color) : null}
                {c.tier?.displayName ?? '—'}
              </span>
              <span className="w-32 shrink-0 truncate text-muted-foreground">
                {c.owner?.displayName ?? c.owner?.name ?? '—'}
              </span>
              <span className="w-20 shrink-0 text-right text-muted-foreground tabular-nums">
                {c.people}
              </span>
              <span className="w-28 shrink-0 text-right text-muted-foreground tabular-nums">
                {c.approximateNeedCount}
              </span>
              <span className="w-20 shrink-0 text-right text-muted-foreground tabular-nums">
                {formatRevenue(c.revenue ?? null, currency)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
