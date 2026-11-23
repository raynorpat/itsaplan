'use client';

import { Users } from 'lucide-react';
import type { Project } from '@/types/project';
import { useUpdateProject } from '@/services/projects.service';
import { useTeamsQuery } from '@/services/teams.service';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Pill } from '@/components/common/fields/Pill';
import ReadOnlyPill from '@/components/common/fields/ReadOnlyPill';
import ProjectTeamsChecklist from '../shared/ProjectTeamsChecklist';

// The project's teams as a pill; the popover adds or removes teams through
// projectUpdate's teamIds. Teams the user cannot see stay on the project (server
// rule), and a team with issues in the project cannot be removed (the API's error
// is shown as a toast).
export default function ProjectTeamsField({
  project,
  readOnly = false,
}: {
  project: Project;
  readOnly?: boolean;
}) {
  const teams = useTeamsQuery().data ?? [];
  const update = useUpdateProject();
  const current = project.teams.map((t) => t.id);

  const change = (teamIds: string[]) => update.mutate({ id: project.id, patch: { teamIds } });

  const pill = (
    <Pill active>
      <Users />
      {project.teams.map((t) => t.key).join(', ') || 'No team'}
    </Pill>
  );
  if (readOnly) return <ReadOnlyPill>{pill}</ReadOnlyPill>;

  return (
    <Popover>
      <PopoverTrigger asChild>{pill}</PopoverTrigger>
      <PopoverContent align="start" className="w-64">
        <ProjectTeamsChecklist teams={teams} value={current} onChange={change} />
      </PopoverContent>
    </Popover>
  );
}
