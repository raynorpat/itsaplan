import { ChevronDown, ChevronUp } from 'lucide-react';
import { TableHead } from '@/components/ui/table';
import type { InitiativeSortKey } from '../utils/sortInitiatives';

// A sortable column header of the initiatives table, in the projects list's look: the
// label is a button, and the active column shows its direction.
export default function InitiativeSortHead({
  label,
  column,
  sort,
  dir,
  onSort,
}: {
  label: string;
  column: InitiativeSortKey;
  sort: InitiativeSortKey | undefined;
  dir: 'asc' | 'desc';
  onSort: (key: InitiativeSortKey) => void;
}) {
  const active = sort === column;
  return (
    <TableHead
      className="px-3 text-xs font-medium text-muted-foreground"
      aria-sort={active ? (dir === 'desc' ? 'descending' : 'ascending') : undefined}
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        className="inline-flex items-center gap-1 hover:text-foreground"
      >
        {label}
        {active &&
          (dir === 'desc' ? (
            <ChevronDown className="size-3.5" />
          ) : (
            <ChevronUp className="size-3.5" />
          ))}
      </button>
    </TableHead>
  );
}
