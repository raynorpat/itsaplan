import { parseDate } from '@/utils/dates';
import type { TimelineScaleModel } from '@/utils/timelineScale';
import type { useProjectTimelineDrag } from '../../hooks/useProjectTimelineDrag';
import { projectSpan, type TimelineProject, type TimelineRow } from '../../utils/projectTimeline';
import ProjectsTimelineGroupRow from './ProjectsTimelineGroupRow';
import ProjectsTimelineRow from './ProjectsTimelineRow';

// The timeline's group headers and project rows, in layout order. `shown` holds each
// project as it shows now (a dragged one at its preview dates); a drag starts from
// the stored project in `stored`.
export default function ProjectsTimelineRows({
  rows,
  shown,
  stored,
  scale,
  drag,
  teamKey,
  labelW,
  readOnly,
  onToggleGroup,
}: {
  rows: TimelineRow[];
  shown: Map<string, TimelineProject>;
  stored: Map<string, TimelineProject>;
  scale: TimelineScaleModel;
  drag: ReturnType<typeof useProjectTimelineDrag>;
  teamKey: string;
  labelW: number;
  readOnly: boolean;
  onToggleGroup: (groupKey: string) => void;
}) {
  return rows.map((row) => {
    if (row.kind === 'group')
      return (
        <ProjectsTimelineGroupRow
          key={`g-${row.groupKey}`}
          label={row.label}
          count={row.count}
          collapsed={row.collapsed}
          labelW={labelW}
          trackWidth={scale.trackWidth}
          onToggle={() => onToggleGroup(row.groupKey)}
        />
      );
    const project = shown.get(row.projectId);
    const original = stored.get(row.projectId);
    const span = project && projectSpan(project);
    if (!project || !original || !span) return null;
    return (
      <ProjectsTimelineRow
        key={`${row.groupKey}-${row.projectId}`}
        project={project}
        rect={scale.spanToRect(span.start, span.end)}
        point={span.point}
        milestones={project.milestones.flatMap((m) => {
          const day = parseDate(m.targetDate);
          return day ? [{ milestone: m, x: scale.xOf(day) + scale.dayWidth / 2 }] : [];
        })}
        teamKey={teamKey}
        labelW={labelW}
        trackWidth={scale.trackWidth}
        dayLines={scale.dayLines}
        todayInRange={scale.todayInRange}
        todayLeft={scale.todayLeft}
        active={drag.projectPreview(project.id) != null}
        activeMilestoneId={project.milestones.find((m) => drag.milestonePreview(m.id))?.id ?? null}
        readOnly={readOnly}
        onBeginDrag={(e, mode) => drag.beginProjectDrag(e, original, mode)}
        onBeginMilestoneDrag={(e, m) => {
          const stored = original.milestones.find((x) => x.id === m.id);
          if (stored) drag.beginMilestoneDrag(e, original, stored);
        }}
      />
    );
  });
}
