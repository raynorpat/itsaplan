'use client';

import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { DependencyMarker } from '../../utils/arrows';

// A dependency whose other project is not on the timeline: a small dot at this
// project's anchor, naming the other project in its tooltip.
export default function ProjectsTimelineDependencyMarker({ marker }: { marker: DependencyMarker }) {
  const text =
    marker.kind === 'blockedBy' ? `Blocked by ${marker.otherName}` : `Blocking ${marker.otherName}`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={text}
          className={cn(
            'pointer-events-auto absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background',
            marker.conflict ? 'bg-destructive' : 'bg-muted-foreground',
          )}
          style={{ left: marker.x, top: marker.y }}
        />
      </TooltipTrigger>
      <TooltipContent>
        {text}
        {marker.conflict ? ' (dates conflict)' : ''}
      </TooltipContent>
    </Tooltip>
  );
}
