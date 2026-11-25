'use client';

import { useEffect, useRef, useState } from 'react';
import type { QueryKey } from '@tanstack/react-query';
import { LABEL_W, timelineScale } from '@/utils/timelineScale';
import { TimelineHeader } from '@/components/common/timeline/TimelineHeader';
import { useProjectTimelineDrag } from '../../hooks/useProjectTimelineDrag';
import type { ProjectsDisplay } from '../../utils/projectsDisplay';
import {
  buildProjectTimeline,
  dropDates,
  flattenTimelineRows,
  projectPositions,
  rowsHeight,
  timelineRange,
  withPreview,
  type ProjectPositions,
  type TimelineProject,
} from '../../utils/projectTimeline';
import ProjectsTimelineToolbar from './ProjectsTimelineToolbar';
import ProjectsTimelineRows from './ProjectsTimelineRows';
import ProjectsTimelineNoDates from './ProjectsTimelineNoDates';

// What a layer drawn over the track (the dependency arrows) gets: where each shown
// project's anchors are, in px from the track's top-left corner under the header.
export interface ProjectsTimelineOverlay {
  positions: ProjectPositions;
  trackWidth: number;
  height: number;
  // Highlights these projects' rows (null clears), e.g. while an arrow is hovered.
  onHighlight: (projectIds: string[] | null) => void;
}

// The projects of the open tab as bars on a date track, grouped, with milestones and
// the projects without dates below. Bars and milestones are dragged to change dates.
export default function ProjectsTimeline({
  projects,
  display,
  onDisplay,
  teamKey,
  leadName,
  readOnly,
  queryKey,
  overlay,
}: {
  projects: TimelineProject[];
  display: ProjectsDisplay;
  onDisplay: (patch: Partial<ProjectsDisplay>) => void;
  teamKey: string;
  leadName: (id: string) => string;
  readOnly: boolean;
  queryKey: QueryKey;
  overlay?: (layer: ProjectsTimelineOverlay) => React.ReactNode;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewportW, setViewportW] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth : 1200,
  );
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewportW(el.clientWidth));
    ro.observe(el);
    setViewportW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [highlighted, setHighlighted] = useState<Set<string>>(new Set());

  const labelW = viewportW < 640 ? 140 : LABEL_W;
  const { from, to } = timelineRange(projects);
  const scale = timelineScale({ from, to, zoom: display.zoom, viewportW, labelW });
  const drag = useProjectTimelineDrag({ dayW: scale.dayWidth, queryKey });

  const stored = new Map(projects.map((p) => [p.id, p]));
  const shown = new Map(
    projects.map((p) => [
      p.id,
      withPreview(p, drag.projectPreview(p.id), (id) => drag.milestonePreview(id)?.start ?? null),
    ]),
  );
  const layout = buildProjectTimeline(projects, { grouping: display.grouping, leadName });
  const rows = flattenTimelineRows(layout, { collapsed, headers: display.grouping !== 'none' });

  const toggleGroup = (key: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ProjectsTimelineToolbar
        grouping={display.grouping}
        zoom={display.zoom}
        onGrouping={(grouping) => onDisplay({ grouping })}
        onZoom={(zoom) => onDisplay({ zoom })}
        onToday={() =>
          scrollRef.current?.scrollTo({ left: Math.max(0, scale.todayLeft - viewportW / 3) })
        }
      />
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto border-t">
        <div style={{ width: labelW + scale.trackWidth }}>
          <TimelineHeader
            labelW={labelW}
            trackWidth={scale.trackWidth}
            dayW={scale.dayWidth}
            months={scale.months}
            days={scale.days}
          />
          {rows.length === 0 && layout.noDates.length === 0 && (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No projects to place on the timeline.
            </div>
          )}
          <div className="relative">
            <ProjectsTimelineRows
              rows={rows}
              shown={shown}
              stored={stored}
              scale={scale}
              drag={drag}
              teamKey={teamKey}
              labelW={labelW}
              readOnly={readOnly}
              highlighted={highlighted}
              onToggleGroup={toggleGroup}
            />
            {overlay && (
              <div className="pointer-events-none absolute top-0" style={{ left: labelW }}>
                {overlay({
                  positions: projectPositions(rows, shown, scale.xOf, scale.dayWidth),
                  trackWidth: scale.trackWidth,
                  height: rowsHeight(rows),
                  onHighlight: (ids) => setHighlighted(new Set(ids ?? [])),
                })}
              </div>
            )}
          </div>
          <ProjectsTimelineNoDates
            projects={layout.noDates.flatMap((id) => stored.get(id) ?? [])}
            teamKey={teamKey}
            labelW={labelW}
            trackWidth={scale.trackWidth}
            dayLines={scale.dayLines}
            readOnly={readOnly}
            onSchedule={(id, x) => drag.schedule(id, dropDates(scale.dateOf(x)))}
          />
        </div>
      </div>
    </div>
  );
}
