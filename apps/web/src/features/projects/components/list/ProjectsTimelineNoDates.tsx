import Link from 'next/link';
import { projectPath } from '@/utils/paths';
import { GROUP_H, ROW_H } from '@/utils/timelineScale';
import { cn } from '@/lib/utils';
import type { TimelineProject } from '../../utils/projectTimeline';

// Projects with neither date, under the timeline. Clicking a day on a project's own
// track schedules it from that day (dropDates: two weeks long).
export default function ProjectsTimelineNoDates({
  projects,
  teamKey,
  labelW,
  trackWidth,
  dayLines,
  readOnly,
  onSchedule,
}: {
  projects: TimelineProject[];
  teamKey: string;
  labelW: number;
  trackWidth: number;
  dayLines: { backgroundImage: string };
  readOnly: boolean;
  // `x`: the pointer's distance from the track's left edge.
  onSchedule: (projectId: string, x: number) => void;
}) {
  if (projects.length === 0) return null;
  return (
    <section aria-label="Projects without dates">
      <div className="flex border-b bg-muted/40" style={{ height: GROUP_H }}>
        <div
          className="sticky left-0 z-30 flex shrink-0 items-center gap-2 border-r bg-muted/40 px-3 text-sm font-medium"
          style={{ width: labelW }}
        >
          <span className="min-w-0 flex-1 truncate">No dates</span>
          <span className="shrink-0 text-muted-foreground">{projects.length}</span>
        </div>
        <div style={{ width: trackWidth }} />
      </div>
      {projects.map((p) => (
        <div key={p.id} className="flex border-b hover:bg-accent/20" style={{ height: ROW_H }}>
          <div
            className="sticky left-0 z-30 flex shrink-0 items-center overflow-hidden border-r bg-background px-3"
            style={{ width: labelW }}
          >
            <Link
              href={projectPath(teamKey, p.id)}
              className="min-w-0 flex-1 truncate text-sm text-muted-foreground hover:underline"
            >
              {p.name}
            </Link>
          </div>
          <div
            className={cn('relative', !readOnly && 'cursor-copy')}
            style={{ width: trackWidth, ...dayLines }}
            title={readOnly ? undefined : 'Click a day to schedule this project'}
            onClick={
              readOnly
                ? undefined
                : (e) => onSchedule(p.id, e.clientX - e.currentTarget.getBoundingClientRect().left)
            }
          />
        </div>
      ))}
    </section>
  );
}
