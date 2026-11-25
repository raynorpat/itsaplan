'use client';

import Link from 'next/link';
import Avatar from '@/components/common/Avatar';
import { Button } from '@/components/ui/button';
import { feedbackPersonPath } from '@/utils/paths';
import { useCustomerPeople } from '../services/customerPage.service';

// The people who belong to the customer, by email domain or picked by hand.
export default function CustomerPeople({ customerId }: { customerId: string }) {
  const query = useCustomerPeople(customerId, true);
  return (
    <section className="pb-4">
      <h2 className="px-4 pb-1.5 text-sm font-medium">People</h2>
      {query.isPending ? (
        <p className="px-4 text-sm text-muted-foreground">Loading…</p>
      ) : query.people.length === 0 ? (
        <p className="px-4 text-sm text-muted-foreground">
          No one yet. People join by email domain, or from their page.
        </p>
      ) : (
        <ul className="divide-y border-y">
          {query.people.map((p) => (
            <li key={p.id}>
              <Link
                href={feedbackPersonPath(p.id)}
                className="flex items-center gap-3 px-4 py-2 text-sm hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none"
              >
                <Avatar name={p.name} image={p.avatarUrl} />
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{p.name}</span>
                  {p.email && <span className="ml-2 text-xs text-muted-foreground">{p.email}</span>}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {p.source === 'manual' ? 'Set by hand' : 'From email domain'}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {query.hasNextPage && (
        <div className="flex justify-center py-2">
          <Button
            variant="outline"
            size="sm"
            disabled={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            Load more
          </Button>
        </div>
      )}
    </section>
  );
}
