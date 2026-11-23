'use client';

import type { TeamDetail } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import type { ProjectDetail } from '@/services/projects.service';
import ProjectActivityFeed from './ProjectActivityFeed';
import ProjectActiveWork from './ProjectActiveWork';
import ProjectDescription from './ProjectDescription';
import ProjectLatestUpdate from './ProjectLatestUpdate';
import ProjectMilestones from './ProjectMilestones';
import ProjectProperties from './ProjectProperties';
import ProjectStateBreakdown from './ProjectStateBreakdown';
import ProjectTimeline from './ProjectTimeline';

// The project overview: name, properties and description, progress, the latest
// update and milestones in the content column, with the activity beside it,
// stacking below it on a narrow screen.
export default function ProjectOverview({
  project,
  team,
}: {
  project: ProjectDetail;
  team: TeamDetail;
}) {
  const canEdit = usePermissions().can('projects', 'edit');

  return (
    <div className="flex w-full flex-col gap-10 px-8 py-8 lg:flex-row">
      <div className="min-w-0 lg:w-2/3">
        <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
        <div className="mt-4">
          <ProjectProperties project={project} team={team} canEdit={canEdit} />
        </div>
        <ProjectDescription project={project} canEdit={canEdit} />

        <div className="mt-8 grid gap-8 sm:grid-cols-2 sm:gap-10">
          <ProjectStateBreakdown team={team} projectId={project.id} scope={project.scope ?? 0} />
          <ProjectTimeline project={project} />
        </div>

        <div className="mt-8">
          <ProjectLatestUpdate project={project} teamKey={team.team.key} />
        </div>

        <div className="mt-8">
          <ProjectMilestones project={project} canEdit={canEdit} />
        </div>

        <ProjectActiveWork team={team} projectId={project.id} />
      </div>

      <aside className="min-w-0 lg:w-1/3">
        <h3 className="mb-4 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Activity
        </h3>
        <ProjectActivityFeed projectId={project.id} team={team} />
      </aside>
    </div>
  );
}
