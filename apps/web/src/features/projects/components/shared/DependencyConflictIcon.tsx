'use client';

import { TriangleAlert } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

// Marks a dependency whose dates conflict: the blocking date falls after the blocked one.
export default function DependencyConflictIcon({ label }: { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span role="img" aria-label={label} className="inline-flex text-amber-500">
          <TriangleAlert className="size-3.5" />
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
