'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { AuditEntry } from '../services/auditLog.service';
import { describeEntry } from '../utils/auditLog';
import AuditEntryDetail from './AuditEntryDetail';
import AuditLogRow from './AuditLogRow';

// The entries newest first, 50 at a time, each opening its detail.
export default function AuditLogTable({
  entries,
  descriptions,
  hasMore,
  loadingMore,
  onLoadMore,
}: {
  entries: AuditEntry[];
  descriptions: Map<string, string>;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}) {
  const [open, setOpen] = useState<AuditEntry | null>(null);
  const summary = (e: AuditEntry) => describeEntry(e, descriptions.get(e.type) ?? null);
  if (entries.length === 0)
    return <p className="py-6 text-sm text-muted-foreground">No entries match.</p>;
  return (
    <div>
      <div className="grid grid-cols-[10rem_10rem_1fr_8rem] gap-3 border-y px-4 py-1.5 text-xs text-muted-foreground">
        <span>Date (your time)</span>
        <span>Person</span>
        <span>Action</span>
        <span>IP address</span>
      </div>
      <ul className="divide-y border-b">
        {entries.map((e) => (
          <AuditLogRow key={e.id} entry={e} summary={summary(e)} onOpen={() => setOpen(e)} />
        ))}
      </ul>
      {hasMore && (
        <div className="py-3 text-center">
          <Button variant="ghost" size="sm" disabled={loadingMore} onClick={onLoadMore}>
            {loadingMore ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      )}
      <AuditEntryDetail
        entry={open}
        summary={open ? summary(open) : ''}
        onClose={() => setOpen(null)}
      />
    </div>
  );
}
