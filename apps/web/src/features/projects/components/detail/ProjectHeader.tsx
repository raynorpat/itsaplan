'use client';

import { Info } from 'lucide-react';
import type { Project, ProjectPatch, TeamDetail } from '@/lib/api';
import { useUpdateProject } from '@/services/projects.service';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import AssigneeSelect from '@/components/common/fields/AssigneeSelect';
import DatePill from '@/components/common/fields/DatePill';
import LabelsSelect from '@/components/common/fields/LabelsSelect';
import PrioritySelect from '@/components/common/fields/PrioritySelect';
import ProjectStatusSelect from '../shared/ProjectStatusSelect';
import HealthBadge from '../shared/HealthBadge';
import HealthInfoPopover from '../shared/HealthInfoPopover';
import ProgressBar from '../shared/ProgressBar';
import ProjectActions from './ProjectActions';

// The project detail header. The pills patch the project inline; title and
// description are read-only here and edited from the overflow menu dialog.
export default function ProjectHeader({ project, team }: { project: Project; team: TeamDetail }) {
  const update = useUpdateProject(team.team.key);
  const hasDescription = project.content.trim().length > 0;

  const patch = (p: ProjectPatch) => update.mutate({ id: project.id, patch: p });

  const toggleLabel = (labelId: string) => {
    const next = project.labelIds.includes(labelId)
      ? project.labelIds.filter((id) => id !== labelId)
      : [...project.labelIds, labelId];
    patch({ labelIds: next });
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5 border-b px-6 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <span className="text-sm font-semibold">{project.name}</span>
          {hasDescription && (
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label="Show description"
                  className="rounded p-0.5 text-muted-foreground/60 hover:text-foreground"
                >
                  <Info className="size-3.5" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-80">
                <div className="text-sm font-semibold">{project.name}</div>
                <p className="mt-1.5 max-h-64 overflow-y-auto text-sm whitespace-pre-wrap text-muted-foreground">
                  {project.content}
                </p>
              </PopoverContent>
            </Popover>
          )}
        </div>

        <span className="mx-1 h-4 w-px bg-border" />

        <ProjectStatusSelect value={project.status} onChange={(status) => patch({ status })} />
        <AssigneeSelect
          assignees={team.assignees}
          value={project.leadUserId}
          onChange={(leadUserId) => patch({ leadUserId })}
          placeholder="No lead"
        />
        <PrioritySelect value={project.priority} onChange={(priority) => patch({ priority })} />
        <DatePill
          value={project.targetDate}
          placeholder="Target date"
          onChange={(v) => patch({ targetDate: v })}
        />
        <LabelsSelect
          labels={team.labels}
          groups={team.labelGroups}
          value={project.labelIds}
          onToggle={toggleLabel}
        />
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <div className="flex items-center gap-1">
          <HealthInfoPopover />
          <HealthBadge health={project.health} />
        </div>
        <ProgressBar progress={project.progress} />
        <ProjectActions project={project} teamKey={team.team.key} />
      </div>
    </div>
  );
}
