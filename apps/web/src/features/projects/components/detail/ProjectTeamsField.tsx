'use client';

import { useState } from 'react';
import { Users } from 'lucide-react';
import type { Project } from '@/lib/api';
import { useSetProjectTeams } from '@/services/projects.service';
import { useTeamsQuery } from '@/services/teams.service';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Pill } from '@/components/common/fields/Pill';
import ProjectTeamsChecklist from '../shared/ProjectTeamsChecklist';

// The project's teams as a pill; the popover adds or removes teams the user may
// edit projects in. Teams the user cannot see stay on the project (server rule),
// and a team with issues in the project cannot be removed (the error is shown).
export default function ProjectTeamsField({ project }: { project: Project }) {
  const teams = useTeamsQuery().data ?? [];
  const setTeams = useSetProjectTeams();
  const [error, setError] = useState<string | null>(null);
  const current = project.teams.map((t) => t.id);

  const change = (teamIds: string[]) => {
    setError(null);
    setTeams.mutate(
      { id: project.id, teamIds },
      { onError: (err) => setError(err instanceof Error ? err.message : 'Could not change teams') },
    );
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Pill active>
          <Users />
          {project.teams.map((t) => t.key).join(', ') || 'No team'}
        </Pill>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64">
        <ProjectTeamsChecklist teams={teams} value={current} onChange={change} />
        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      </PopoverContent>
    </Popover>
  );
}
