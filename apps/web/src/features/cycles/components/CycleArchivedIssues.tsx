'use client';

import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { useShell } from '@/context/shellContext';
import { cn } from '@/lib/utils';
import { useArchivedCycleIssues } from '../services/cycles.service';

// A past cycle's archived issues, read-only: archived issues are not on the board,
// and opening one shows it on its own page.
export default function CycleArchivedIssues({ cycleId }: { cycleId: string }) {
  const { onOpenIssue } = useShell();
  const [open, setOpen] = useState(false);
  const archived = useArchivedCycleIssues(cycleId);
  const issues = archived.data ?? [];
  if (issues.length === 0) return null;

  return (
    <section className="border-t">
      <button
        type="button"
        className="flex w-full items-center gap-1.5 px-6 py-2 text-xs font-medium text-muted-foreground hover:bg-muted/50"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
        Archived issues ({issues.length})
      </button>
      {open && (
        <ul className="max-h-64 overflow-y-auto pb-2">
          {issues.map((issue) => (
            <li key={issue.id}>
              <button
                type="button"
                className="flex w-full items-center gap-3 px-6 py-1.5 text-left text-sm hover:bg-muted/50"
                onClick={() => onOpenIssue(issue.id)}
              >
                <span className="w-16 shrink-0 text-xs text-muted-foreground tabular-nums">
                  {issue.identifier}
                </span>
                <span className="min-w-0 truncate">{issue.title}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
