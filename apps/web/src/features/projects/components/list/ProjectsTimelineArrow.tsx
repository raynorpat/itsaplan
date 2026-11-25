'use client';

import { cn } from '@/lib/utils';
import type { ArrowPath } from '../../utils/arrows';

// One dependency arrow: a thin line from the blocking anchor to the blocked one, red
// when their dates conflict. A wider transparent copy under it makes it easy to hover.
export default function ProjectsTimelineArrow({
  arrow,
  onHover,
}: {
  arrow: ArrowPath;
  onHover: (hovered: boolean) => void;
}) {
  return (
    <g
      className="pointer-events-auto"
      onPointerEnter={() => onHover(true)}
      onPointerLeave={() => onHover(false)}
    >
      <path d={arrow.d} fill="none" stroke="transparent" strokeWidth={10} />
      <path
        d={arrow.d}
        fill="none"
        strokeWidth={1.5}
        markerEnd={`url(#${arrow.conflict ? 'dependency-arrowhead-conflict' : 'dependency-arrowhead'})`}
        className={cn(arrow.conflict ? 'stroke-destructive' : 'stroke-muted-foreground')}
      >
        <title>{arrow.conflict ? 'Dependency with conflicting dates' : 'Dependency'}</title>
      </path>
    </g>
  );
}
