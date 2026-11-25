'use client';

import { ArrowDown, ArrowUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CustomerSortKey, SortDir } from '../utils/customers';

// A column heading of the Customers list that sorts by its column; a second click
// reverses the order.
export default function CustomerSortHeader({
  label,
  column,
  sort,
  onSort,
  className,
}: {
  label: string;
  column: CustomerSortKey;
  sort: { key: CustomerSortKey; dir: SortDir };
  onSort: (key: CustomerSortKey) => void;
  className?: string;
}) {
  const active = sort.key === column;
  const Arrow = sort.dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      onClick={() => onSort(column)}
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
      className={cn(
        'inline-flex items-center gap-1 rounded text-xs text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        active && 'text-foreground',
        className,
      )}
    >
      {label}
      {active && <Arrow className="size-3" aria-hidden />}
    </button>
  );
}
