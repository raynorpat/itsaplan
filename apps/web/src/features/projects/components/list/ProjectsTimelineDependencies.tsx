'use client';

import { useAllProjectRelations } from '@/services/projectRelations.service';
import { arrowPaths, offscreenMarkers } from '../../utils/arrows';
import type { ProjectsTimelineOverlay } from './ProjectsTimeline';
import ProjectsTimelineArrow from './ProjectsTimelineArrow';
import ProjectsTimelineDependencyMarker from './ProjectsTimelineDependencyMarker';

// The dependency layer over the projects timeline: an arrow for each relation whose two
// projects are shown, and a marker where the other project is not on the timeline.
// The layer itself lets the pointer through; only arrows and markers take it.
export default function ProjectsTimelineDependencies({
  layer,
}: {
  layer: ProjectsTimelineOverlay;
}) {
  const relations = useAllProjectRelations().data ?? [];
  const arrows = arrowPaths(relations, layer.positions);
  const markers = offscreenMarkers(relations, layer.positions);
  return (
    <div className="relative" style={{ width: layer.trackWidth, height: layer.height }}>
      <svg
        className="absolute inset-0 overflow-visible"
        width={layer.trackWidth}
        height={layer.height}
        aria-hidden
      >
        <defs>
          {/* One arrowhead per colour: context-stroke is not supported in every browser. */}
          {(
            [
              ['dependency-arrowhead', 'fill-muted-foreground'],
              ['dependency-arrowhead-conflict', 'fill-destructive'],
            ] as const
          ).map(([id, fill]) => (
            <marker
              key={id}
              id={id}
              viewBox="0 0 8 8"
              refX="7"
              refY="4"
              markerWidth="6"
              markerHeight="6"
              orient="auto"
            >
              <path d="M 0 0 L 8 4 L 0 8 z" className={fill} />
            </marker>
          ))}
        </defs>
        {arrows.map((arrow) => (
          <ProjectsTimelineArrow
            key={arrow.id}
            arrow={arrow}
            onHover={(hovered) => layer.onHighlight(hovered ? [arrow.fromId, arrow.toId] : null)}
          />
        ))}
      </svg>
      {markers.map((marker) => (
        <ProjectsTimelineDependencyMarker key={marker.id} marker={marker} />
      ))}
    </div>
  );
}
