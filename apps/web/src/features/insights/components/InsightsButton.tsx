'use client';

import { ChartColumn } from 'lucide-react';
import { cn } from '@/lib/utils';

// The view header's Insights toggle, next to Display.
export default function InsightsButton({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      title="Insights"
      aria-label="Insights"
      aria-pressed={open}
      onClick={onToggle}
      className={cn(
        'rounded-md p-1.5 hover:bg-accent hover:text-foreground',
        open ? 'bg-accent text-foreground' : 'text-muted-foreground',
      )}
    >
      <ChartColumn className="size-4" />
    </button>
  );
}
