import { isConflict, type ProjectRelationItem, type RelationEnd } from '@/utils/projectRelations';
import type { ProjectPosition, ProjectPositions } from './projectTimeline';

// Dependency arrows over the projects timeline: each relation whose two projects are
// on the timeline is a path from the blocking anchor to the blocked anchor; a relation
// with only one project shown is a marker on that project's anchor. The relations come
// from the API, which lists only relations whose two projects the viewer can see.

// How far an arrow leaves its anchor sideways before turning, in px.
const STUB = 8;

// The x of an anchor on the track, or null when that milestone is not on the timeline.
export function anchorX(pos: ProjectPosition, end: RelationEnd): number | null {
  switch (end.anchorType) {
    case 'start':
      return pos.startX;
    case 'end':
      return pos.endX;
    case 'milestone':
      return end.milestone ? (pos.milestoneX.get(end.milestone.id) ?? null) : null;
  }
}

export interface ArrowPath {
  id: string;
  fromId: string;
  toId: string;
  // SVG path data: right-angled segments only.
  d: string;
  conflict: boolean;
}

export function arrowPaths(
  relations: ProjectRelationItem[],
  positions: ProjectPositions,
): ArrowPath[] {
  const arrows: ArrowPath[] = [];
  for (const r of relations) {
    const from = positions.get(r.from.projectId);
    const to = positions.get(r.to.projectId);
    if (!from || !to) continue;
    const x1 = anchorX(from, r.from);
    const x2 = anchorX(to, r.to);
    if (x1 === null || x2 === null) continue;
    // Leave the blocking anchor to the right, run to the blocked row, then along it.
    const turn = x1 + STUB;
    arrows.push({
      id: r.id,
      fromId: r.from.projectId,
      toId: r.to.projectId,
      d: `M ${x1} ${from.y} H ${turn} V ${to.y} H ${x2}`,
      conflict: isConflict(r),
    });
  }
  return arrows;
}

export interface DependencyMarker {
  id: string;
  // The project on the timeline, and whether the hidden project blocks it or it blocks
  // the hidden one.
  projectId: string;
  kind: 'blockedBy' | 'blocking';
  otherName: string;
  x: number;
  y: number;
  conflict: boolean;
}

export function offscreenMarkers(
  relations: ProjectRelationItem[],
  positions: ProjectPositions,
): DependencyMarker[] {
  const markers: DependencyMarker[] = [];
  for (const r of relations) {
    const from = positions.get(r.from.projectId);
    const to = positions.get(r.to.projectId);
    if ((from && to) || (!from && !to)) continue;
    const shown = from ? r.from : r.to;
    const other = from ? r.to : r.from;
    const pos = (from ?? to)!;
    const x = anchorX(pos, shown);
    if (x === null) continue;
    markers.push({
      id: r.id,
      projectId: shown.projectId,
      kind: from ? 'blocking' : 'blockedBy',
      otherName: other.projectName,
      x,
      y: pos.y,
      conflict: isConflict(r),
    });
  }
  return markers;
}
