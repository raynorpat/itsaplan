'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import type { ProjectDetail } from '@/services/projects.service';
import { useProjectRelations } from '@/services/projectRelations.service';
import type { ProjectRelationItem } from '@/utils/projectRelations';
import { Button } from '@/components/ui/button';
import AddDependencyDialog from './AddDependencyDialog';
import ProjectDependencyRow from './ProjectDependencyRow';

// The project's dependencies (Linear's project relations): the projects it is
// blocked by and the projects it blocks, with Add dependency for people who can edit.
export default function ProjectDependencies({
  project,
  teamKey,
  canEdit,
}: {
  project: ProjectDetail;
  teamKey: string;
  canEdit: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const { blockedBy, blocking } = useProjectRelations(project.id);
  if (!canEdit && blockedBy.length === 0 && blocking.length === 0) return null;

  const list = (title: string, relations: ProjectRelationItem[]) =>
    relations.length > 0 && (
      <div className="flex flex-col">
        <h3 className="text-xs text-muted-foreground">{title}</h3>
        <ul className="flex flex-col">
          {relations.map((r) => (
            <ProjectDependencyRow
              key={r.id}
              relation={r}
              projectId={project.id}
              teamKey={teamKey}
              canEdit={canEdit}
            />
          ))}
        </ul>
      </div>
    );

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Dependencies</h2>
        {canEdit && (
          <Button variant="ghost" size="sm" onClick={() => setAdding(true)}>
            <Plus className="size-3.5" />
            Add dependency
          </Button>
        )}
      </div>
      {list('Blocked by', blockedBy)}
      {list('Blocking', blocking)}
      {adding && (
        <AddDependencyDialog project={project} teamKey={teamKey} onClose={() => setAdding(false)} />
      )}
    </section>
  );
}
