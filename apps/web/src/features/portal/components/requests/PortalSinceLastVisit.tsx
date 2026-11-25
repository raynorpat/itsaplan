'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSinceLastVisit } from '../../services/portal.service';

const DISMISSED_KEY = 'portal-since-last-visit-dismissed';

// "Since your last visit" at the top of a board: what changed on the requests the
// visitor follows. Hidden when nothing changed; a dismissal lasts for the browser tab.
export default function PortalSinceLastVisit() {
  const [dismissed, setDismissed] = useState(
    () => typeof window !== 'undefined' && sessionStorage.getItem(DISMISSED_KEY) === '1',
  );
  const summary = useSinceLastVisit(!dismissed).data;
  if (dismissed || !summary || summary.lines.length === 0) return null;
  return (
    <section
      aria-label="Since your last visit"
      className="relative flex flex-col gap-2 rounded-md border bg-muted/40 px-4 py-3"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium">Since your last visit</h2>
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          aria-label="Dismiss"
          onClick={() => {
            sessionStorage.setItem(DISMISSED_KEY, '1');
            setDismissed(true);
          }}
        >
          <X className="size-3.5" />
        </Button>
      </div>
      {summary.paragraph && <p className="text-sm">{summary.paragraph}</p>}
      <ul className="flex flex-col gap-0.5 text-sm text-muted-foreground">
        {summary.lines.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
    </section>
  );
}
