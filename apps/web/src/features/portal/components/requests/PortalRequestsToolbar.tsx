import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { PortalSort } from '../../services/portal.service';

const SORTS: { value: PortalSort; label: string }[] = [
  { value: 'top', label: 'Top' },
  { value: 'new', label: 'New' },
];

export default function PortalRequestsToolbar({
  sort,
  onSort,
  q,
  onQ,
}: {
  sort: PortalSort;
  onSort: (sort: PortalSort) => void;
  q: string;
  onQ: (q: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex gap-1" role="group" aria-label="Order">
        {SORTS.map((s) => (
          <button
            key={s.value}
            type="button"
            aria-pressed={sort === s.value}
            onClick={() => onSort(s.value)}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm transition-colors',
              sort === s.value
                ? 'bg-secondary font-medium'
                : 'text-muted-foreground hover:bg-accent',
            )}
          >
            {s.label}
          </button>
        ))}
      </div>
      <Input
        type="search"
        aria-label="Search requests"
        placeholder="Search"
        className="ml-auto h-8 max-w-56"
        value={q}
        onChange={(e) => onQ(e.target.value)}
      />
    </div>
  );
}
