import { useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  importStatusText,
  SERVICE_LABEL,
  type ImportService,
  type ImportView,
} from '../utils/imports';

function summaryText(imp: ImportView): string | null {
  const s = imp.summary;
  if (imp.status !== 'complete' || !s) return null;
  const parts = [
    `${s.issues} ${s.issues === 1 ? 'issue' : 'issues'}`,
    `${s.comments} ${s.comments === 1 ? 'comment' : 'comments'}`,
  ];
  if (s.labelsCreated) parts.push(`${s.labelsCreated} labels created`);
  if (s.skippedExisting) parts.push(`${s.skippedExisting} already imported`);
  if (s.skipped.length) parts.push(`${s.skipped.length} skipped`);
  return parts.join(' · ');
}

// One import in the list: repository, source, team, status (with progress while it
// creates records), and the summary or error when done.
export default function ImportRow({
  imp,
  teamName,
  onMatchPeople,
}: {
  imp: ImportView;
  teamName: string | null;
  onMatchPeople: () => void;
}) {
  const [showSkipped, setShowSkipped] = useState(false);
  const label = SERVICE_LABEL[imp.service as ImportService] ?? imp.service;
  const summary = summaryText(imp);
  const skipped = imp.summary?.skipped ?? [];
  return (
    <div className="flex flex-col gap-1.5 p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{imp.displayName}</div>
          <div className="text-xs text-muted-foreground">
            {label} → {teamName ?? imp.teamName ?? 'a team'} ·{' '}
            {formatDistanceToNow(new Date(imp.createdAt), { addSuffix: true })}
          </div>
        </div>
        {imp.awaitingPeople ? (
          <Button size="sm" onClick={onMatchPeople}>
            Match people
          </Button>
        ) : (
          <span
            role="status"
            className={cn(
              'shrink-0 text-sm',
              imp.status === 'error' ? 'text-destructive' : 'text-muted-foreground',
            )}
          >
            {importStatusText(imp)}
          </span>
        )}
      </div>
      {imp.status === 'inProcess' && (
        <div
          className="h-1 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-label="Import progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(imp.progress ?? 0)}
        >
          <div
            className="h-full bg-foreground/60 transition-[width]"
            style={{ width: `${imp.progress ?? 0}%` }}
          />
        </div>
      )}
      {imp.awaitingPeople && (
        <p className="text-xs text-muted-foreground">{importStatusText(imp)}</p>
      )}
      {summary && <p className="text-xs text-muted-foreground">{summary}</p>}
      {skipped.length > 0 && (
        <div>
          <button
            type="button"
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
            aria-expanded={showSkipped}
            onClick={() => setShowSkipped((v) => !v)}
          >
            {showSkipped ? 'Hide skipped issues' : 'Show skipped issues'}
          </button>
          {showSkipped && (
            <ul className="mt-1 space-y-0.5">
              {skipped.map((s) => (
                <li key={s.url} className="text-xs text-muted-foreground">
                  <a href={s.url} target="_blank" rel="noreferrer" className="hover:underline">
                    {s.url}
                  </a>
                  : {s.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
