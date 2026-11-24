'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useArchivedCycles, type CycleListItem } from '../services/cycles.service';
import CycleRow from './CycleRow';

// The team's archived cycles, collapsed until opened; they load when it opens.
export default function CycleArchivedSection({
  teamId,
  teamKey,
  percentOf,
}: {
  teamId: string;
  teamKey: string;
  percentOf: (cycle: CycleListItem) => number;
}) {
  const [open, setOpen] = useState(false);
  const archived = useArchivedCycles(teamId, open);
  const Chevron = open ? ChevronDown : ChevronRight;
  const cycles = archived.data ?? [];

  let body = null;
  if (open && archived.isLoading)
    body = <p className="px-6 py-2.5 text-sm text-muted-foreground">Loading…</p>;
  else if (open && cycles.length === 0)
    body = <p className="px-6 py-2.5 text-sm text-muted-foreground">No archived cycles.</p>;
  else if (open)
    body = cycles.map((c) => (
      <CycleRow key={c.id} cycle={c} percent={percentOf(c)} teamKey={teamKey} />
    ));

  return (
    <section className="flex flex-col">
      <h2 className="border-b bg-muted/30 text-xs font-medium text-muted-foreground">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-1 px-6 py-2 text-left hover:text-foreground"
        >
          <Chevron className="size-3.5" />
          Archived
        </button>
      </h2>
      {body}
    </section>
  );
}
