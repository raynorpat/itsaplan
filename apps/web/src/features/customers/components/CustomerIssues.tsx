'use client';

import Link from 'next/link';
import { Flame } from 'lucide-react';
import { StateIcon } from '@/components/common/issue/IssueIcons';
import { formatShortDate } from '@/utils/dates';
import { issuePathFromIdentifier } from '@/utils/issueNavigation';
import { useCustomerNeeds } from '../services/customerPage.service';
import { issuesOfCustomer } from '../utils/customers';

// The issues the customer's people asked for, most requests first: status, identifier,
// title, how many requests (and important ones) and the latest request's date.
export default function CustomerIssues({ customerId }: { customerId: string }) {
  const query = useCustomerNeeds(customerId, true);
  const groups = issuesOfCustomer(query.data ?? []);
  return (
    <section className="pb-6">
      <h2 className="px-4 pb-1.5 text-sm font-medium">Requested issues</h2>
      {query.isPending ? (
        <p className="px-4 text-sm text-muted-foreground">Loading…</p>
      ) : groups.length === 0 ? (
        <p className="px-4 text-sm text-muted-foreground">No requests on issues you can see.</p>
      ) : (
        <ul className="divide-y border-y">
          {groups.map((g) => (
            <li key={g.issue.id}>
              <Link
                href={issuePathFromIdentifier(g.issue.identifier)}
                className="flex items-center gap-2 px-4 py-2 text-sm hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none"
              >
                <StateIcon stateType={g.issue.state.type} color={g.issue.state.color} />
                <span className="sr-only">({g.issue.state.name})</span>
                <span className="shrink-0 text-xs text-muted-foreground">{g.issue.identifier}</span>
                <span className="min-w-0 flex-1 truncate font-medium">{g.issue.title}</span>
                {g.important > 0 && (
                  <span className="inline-flex shrink-0 items-center gap-0.5 text-xs text-orange-600 dark:text-orange-400">
                    <Flame className="size-3" aria-hidden />
                    {g.important}
                  </span>
                )}
                <span className="w-24 shrink-0 text-right text-xs text-muted-foreground">
                  {g.requests === 1 ? '1 request' : `${g.requests} requests`}
                </span>
                <span className="w-20 shrink-0 text-right text-xs text-muted-foreground">
                  {formatShortDate(g.lastAt)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
