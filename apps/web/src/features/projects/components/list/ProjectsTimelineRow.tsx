import Link from 'next/link';
import { cn } from '@/lib/utils';
import { projectPath } from '@/utils/paths';
import { healthMeta, STATUS_META } from '@/utils/projectMeta';
import { ROW_H, type DateDragMode } from '@/utils/timelineScale';
import { colorDot } from '@/components/common/fields/colorDot';
import { TimelineBar } from '@/components/common/timeline/TimelineBar';
import { TimelineTodayLine } from '@/components/common/timeline/TimelineTodayLine';
import type { TimelineMilestone, TimelineProject } from '../../utils/projectTimeline';
import ProjectsTimelineMilestone from './ProjectsTimelineMilestone';

// One project on the timeline: its name and health on the left, and on the track a
// bar in its status colour from start to target date (a project with one date is a
// one-day point), with its milestones as diamonds. The bar's body moves both dates
// and its ends change one; a point only moves. Dragging works with the pointer only;
// keyboard users change a project's dates and milestones, and its dependencies, on the
// project page, and the name is the row's keyboard-reachable link.
export default function ProjectsTimelineRow({
  project,
  rect,
  point,
  milestones,
  teamKey,
  labelW,
  trackWidth,
  dayLines,
  todayInRange,
  todayLeft,
  active,
  highlighted,
  activeMilestoneId,
  readOnly,
  onBeginDrag,
  onBeginMilestoneDrag,
}: {
  project: TimelineProject;
  rect: { left: number; width: number };
  point: boolean;
  milestones: { milestone: TimelineMilestone; x: number }[];
  teamKey: string;
  labelW: number;
  trackWidth: number;
  dayLines: { backgroundImage: string };
  todayInRange: boolean;
  todayLeft: number;
  active: boolean;
  highlighted: boolean;
  activeMilestoneId: string | null;
  readOnly: boolean;
  onBeginDrag: (e: React.PointerEvent, mode: DateDragMode) => void;
  onBeginMilestoneDrag: (e: React.PointerEvent, milestone: TimelineMilestone) => void;
}) {
  const health = healthMeta(project.health);
  return (
    <div
      className={cn('flex border-b hover:bg-accent/20', highlighted && 'bg-accent/40')}
      style={{ height: ROW_H }}
    >
      <div
        className="sticky left-0 z-30 flex shrink-0 items-center gap-2 overflow-hidden border-r bg-background px-3"
        style={{ width: labelW }}
      >
        <span title={health.label} className="shrink-0">
          {colorDot(health.color)}
        </span>
        <Link
          href={projectPath(teamKey, project.id)}
          className="min-w-0 flex-1 truncate text-sm text-foreground hover:underline"
        >
          {project.name}
        </Link>
      </div>
      <div className="relative" style={{ width: trackWidth, ...dayLines }}>
        {todayInRange && <TimelineTodayLine left={todayLeft} />}
        <TimelineBar
          rect={rect}
          color={STATUS_META[project.status].color}
          active={active}
          readOnly={readOnly}
          resizeStart={!point}
          resizeEnd={!point}
          title={point ? `${project.name} (one date)` : project.name}
          onBeginDrag={onBeginDrag}
        >
          <span className="truncate text-[11px] leading-none">{project.name}</span>
        </TimelineBar>
        {milestones.map(({ milestone, x }) => (
          <ProjectsTimelineMilestone
            key={milestone.id}
            milestone={milestone}
            x={x}
            active={activeMilestoneId === milestone.id}
            readOnly={readOnly}
            onBeginDrag={(e) => onBeginMilestoneDrag(e, milestone)}
          />
        ))}
      </div>
    </div>
  );
}
