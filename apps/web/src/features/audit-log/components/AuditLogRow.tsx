'use client';

import { formatDateTime } from '@/utils/dates';
import type { AuditEntry } from '../services/auditLog.service';

// One entry in the list: when, who, what, and from which address. Opens its detail.
export default function AuditLogRow({
  entry,
  summary,
  onOpen,
}: {
  entry: AuditEntry;
  summary: string;
  onOpen: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="grid w-full grid-cols-[10rem_10rem_1fr_8rem] items-center gap-3 px-4 py-2 text-left text-sm hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none"
      >
        <span className="text-xs text-muted-foreground">{formatDateTime(entry.createdAt)}</span>
        <span className="truncate">{entry.actor?.name ?? 'No one signed in'}</span>
        <span className="truncate">{summary}</span>
        <span className="truncate text-xs text-muted-foreground">{entry.ip ?? '—'}</span>
      </button>
    </li>
  );
}
