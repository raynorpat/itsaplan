import { cn } from '@/lib/utils';
import type { TimelineMilestone } from '../../utils/projectTimeline';

// A milestone diamond on a project's row, at the middle of its target day. Dragging
// it sideways changes the milestone's target date.
export default function ProjectsTimelineMilestone({
  milestone,
  x,
  active,
  readOnly,
  onBeginDrag,
}: {
  milestone: TimelineMilestone;
  x: number;
  active: boolean;
  readOnly: boolean;
  onBeginDrag: (e: React.PointerEvent) => void;
}) {
  return (
    <div
      role="img"
      aria-label={`Milestone ${milestone.name}`}
      title={milestone.name}
      onPointerDown={readOnly ? undefined : onBeginDrag}
      className={cn(
        'absolute top-1/2 z-20 size-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 border border-background bg-foreground',
        readOnly ? 'cursor-default' : active ? 'cursor-grabbing' : 'cursor-grab',
      )}
      style={{ left: x }}
    />
  );
}
