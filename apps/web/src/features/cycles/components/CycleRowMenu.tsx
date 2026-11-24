'use client';

import { Archive, MoreHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useArchiveCycle, type CycleListItem } from '../services/cycles.service';

// A completed cycle's options on the cycles page: Archive.
export default function CycleRowMenu({
  cycle,
  teamKey,
}: {
  cycle: CycleListItem;
  teamKey: string;
}) {
  const archive = useArchiveCycle(teamKey);

  const run = () =>
    archive.mutate(cycle.id, {
      onSuccess: () => toast.success('Cycle archived.'),
      onError: (err) => toast.error(err.message || 'Could not archive the cycle.'),
    });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Cycle options"
          className="rounded p-0.5 text-muted-foreground/60 hover:text-foreground"
        >
          <MoreHorizontal className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem disabled={archive.isPending} onClick={run}>
          <Archive className="size-4" />
          Archive
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
