'use client';

import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { formatDateTime } from '@/utils/dates';
import type { AuditEntry } from '../services/auditLog.service';

const text = (v: unknown) => (typeof v === 'string' && v ? v : '—');

// One entry in full: when, who, from where, how they were signed in, and its details.
export default function AuditEntryDetail({
  entry,
  summary,
  onClose,
}: {
  entry: AuditEntry | null;
  summary: string;
  onClose: () => void;
}) {
  const info = entry?.requestInformation ?? {};
  const oauthApp = info.oauthApp as { name?: string } | undefined;
  const rows: [string, string][] = entry
    ? [
        ['When', formatDateTime(entry.createdAt)],
        ['Who', entry.actor ? `${entry.actor.name} (${entry.actor.email})` : 'No one signed in'],
        ['IP address', entry.ip ?? '—'],
        ['Country', entry.countryCode ?? '—'],
        ['Signed in with', text(info.method) + (oauthApp?.name ? ` · ${oauthApp.name}` : '')],
        ['Browser', text(info.userAgent)],
        ['Operation', text(info.operation)],
      ]
    : [];
  return (
    <Sheet open={entry != null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          {/* pr-8 keeps a long summary clear of the sheet's close button. */}
          <SheetTitle className="pr-8">{summary}</SheetTitle>
        </SheetHeader>
        {entry && (
          <div className="grid gap-4 px-4 pb-6 text-sm">
            <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5">
              {rows.map(([label, value]) => (
                <div key={label} className="contents">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="break-words">{value}</dd>
                </div>
              ))}
            </dl>
            <div>
              <p className="mb-1 text-muted-foreground">Details</p>
              <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
                {JSON.stringify(entry.metadata ?? {}, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
