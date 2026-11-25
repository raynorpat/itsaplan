import type { QueryKey } from '@tanstack/react-query';
import { parseDate } from '@/utils/dates';
import type { DateDragMode } from '@/utils/timelineScale';
import { useTimelineDateDrag } from '@/hooks/useTimelineDateDrag';
import { useTimelineDateWrite } from '../services/projectTimeline.service';
import {
  projectSpan,
  shiftDate,
  shiftProjectDates,
  type ProjectDates,
  type TimelineMilestone,
  type TimelineProject,
} from '../utils/projectTimeline';

const milestoneDragId = (id: string) => `milestone:${id}`;

// Dragging on the projects timeline: a bar's body moves both dates, an end changes
// one, a milestone diamond moves its target date. Only the horizontal distance
// counts (a project never changes group). Every copy of a project shows the
// preview, since it is keyed by the project.
export function useProjectTimelineDrag({ dayW, queryKey }: { dayW: number; queryKey: QueryKey }) {
  const { preview, beginDateDrag } = useTimelineDateDrag({ dayW });
  const write = useTimelineDateWrite(queryKey);

  function beginProjectDrag(e: React.PointerEvent, project: TimelineProject, mode: DateDragMode) {
    const span = projectSpan(project);
    if (!span) return;
    const dragMode = span.point ? 'move' : mode;
    beginDateDrag(e, {
      id: project.id,
      start: span.start,
      end: span.end,
      mode: dragMode,
      onDrop: ({ deltaDays }) => {
        if (deltaDays === 0) return;
        write.mutate({
          kind: 'project',
          projectId: project.id,
          dates: shiftProjectDates(project, dragMode, deltaDays),
        });
      },
    });
  }

  function beginMilestoneDrag(
    e: React.PointerEvent,
    project: TimelineProject,
    milestone: TimelineMilestone,
  ) {
    const day = parseDate(milestone.targetDate);
    if (!day || !milestone.targetDate) return;
    const date = milestone.targetDate;
    beginDateDrag(e, {
      id: milestoneDragId(milestone.id),
      start: day,
      end: day,
      mode: 'move',
      onDrop: ({ deltaDays }) => {
        if (deltaDays === 0) return;
        write.mutate({
          kind: 'milestone',
          projectId: project.id,
          milestoneId: milestone.id,
          targetDate: shiftDate(date, deltaDays),
        });
      },
    });
  }

  // The dates a project or milestone shows now: the drag preview while it is dragged.
  const previewOf = (id: string) => (preview?.id === id ? preview : null);
  const milestonePreview = (id: string) => previewOf(milestoneDragId(id));

  return {
    beginProjectDrag,
    beginMilestoneDrag,
    projectPreview: previewOf,
    milestonePreview,
    schedule: (projectId: string, dates: ProjectDates) =>
      write.mutate({ kind: 'project', projectId, dates }),
  };
}
