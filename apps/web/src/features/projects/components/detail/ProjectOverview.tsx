'use client';

import type { Project, TeamDetail } from '@/lib/api';
import ProjectActivityFeed from './ProjectActivityFeed';
import ProjectActiveWork from './ProjectActiveWork';
import ProjectStateBreakdown from './ProjectStateBreakdown';
import ProjectTimeline from './ProjectTimeline';
import ProjectMilestones from './ProjectMilestones';

// The project overview: a content column with the activity feed beside it,
// stacking below it on a narrow screen.
export default function ProjectOverview({ project, team }: { project: Project; team: TeamDetail }) {
  const teamKey = team.team.key;
  const hasDescription = project.content.trim().length > 0;

  return (
    <div className="flex w-full flex-col gap-10 px-8 py-8 lg:flex-row">
      <div className="min-w-0 lg:w-2/3">
        <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
        {hasDescription ? (
          <p className="mt-4 text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground">
            {project.content}
          </p>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground/60 italic">No description.</p>
        )}

        <div className="mt-8 grid gap-8 sm:grid-cols-2 sm:gap-10">
          <ProjectStateBreakdown team={team} projectId={project.id} />
          <ProjectTimeline project={project} />
        </div>

        <div className="mt-8">
          <ProjectMilestones projectId={project.id} />
        </div>

        <ProjectActiveWork team={team} projectId={project.id} />
      </div>

      <aside className="min-w-0 lg:w-1/3">
        <h3 className="mb-4 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Activity
        </h3>
        <ProjectActivityFeed projectId={project.id} teamKey={teamKey} />
      </aside>
    </div>
  );
}
