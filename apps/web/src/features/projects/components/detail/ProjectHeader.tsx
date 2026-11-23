'use client';

import type { TeamDetail } from '@/lib/api';
import type { ProjectDetail } from '@/services/projects.service';
import { shownHealth } from '@/utils/health';
import HealthBadge from '@/components/common/updates/HealthBadge';
import HealthInfoPopover from '../shared/HealthInfoPopover';
import ProgressBar from '../shared/ProgressBar';
import ProjectActions from './ProjectActions';

// The project detail header on every tab: the name, the health of the latest update,
// progress and the overflow menu. The properties are edited on the Overview.
export default function ProjectHeader({
  project,
  team,
}: {
  project: ProjectDetail;
  team: TeamDetail;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5 border-b px-6 py-2.5">
      <span className="truncate text-sm font-semibold">{project.name}</span>
      <div className="flex shrink-0 items-center gap-3">
        <div className="flex items-center gap-1">
          <HealthInfoPopover />
          <HealthBadge health={shownHealth(project, project.latestUpdate)} />
        </div>
        <ProgressBar progress={project.progress} />
        <ProjectActions project={project} teamKey={team.team.key} />
      </div>
    </div>
  );
}
