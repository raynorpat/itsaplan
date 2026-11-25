'use client';

import Link from 'next/link';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import type { TableRow } from '@/utils/dashboards/compute';

const label = (r: TableRow): string => {
  const c = r.cells;
  const name = c.title ?? c.name ?? (c.cycle != null ? `Cycle ${c.cycle}` : r.id);
  return [c.identifier, c.team, name].filter((x) => x != null && x !== '').join(' · ');
};

// The items behind one bar or slice of a chart, each opening its issue, project or
// cycle (a dashboard has no view to add the slice's filter to).
export default function WidgetSlicePanel({
  title,
  rows,
  onClose,
}: {
  title: string;
  rows: TableRow[];
  onClose: () => void;
}) {
  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>
            {rows.length} {rows.length === 1 ? 'item' : 'items'}
          </SheetDescription>
        </SheetHeader>
        <ul className="grid gap-1 px-4 pb-4 text-sm">
          {rows.map((r) => (
            <li key={r.id}>
              {r.href ? (
                <Link href={r.href} className="block truncate rounded px-2 py-1 hover:bg-accent">
                  {label(r)}
                </Link>
              ) : (
                <span className="block truncate px-2 py-1">{label(r)}</span>
              )}
            </li>
          ))}
        </ul>
      </SheetContent>
    </Sheet>
  );
}
