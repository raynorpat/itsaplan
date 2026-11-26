'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import type { ProjectDetail } from '@/services/projects.service';
import { Button } from '@/components/ui/button';
import { positionForMove } from '@/utils/position';
import ProjectMilestoneForm from './ProjectMilestoneForm';
import ProjectMilestoneRow from './ProjectMilestoneRow';
import { useCreateMilestone, useUpdateMilestone } from '../../services/projectMilestones.service';

// The project's milestones in Linear's order: add, rename, set a target date, move
// up or down, delete. A move writes only the moved milestone's sortOrder.
export default function ProjectMilestones({
  project,
  canEdit,
}: {
  project: ProjectDetail;
  canEdit: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const create = useCreateMilestone(project.id);
  const update = useUpdateMilestone(project.id);
  const milestones = [...project.milestones].sort((a, b) => a.sortOrder - b.sortOrder);
  if (!canEdit && milestones.length === 0) return null;
  const sortOrders = milestones.map((m) => m.sortOrder);

  const move = (from: number, to: number) =>
    update.mutate({
      id: milestones[from]!.id,
      input: { sortOrder: positionForMove(sortOrders, from, to, 1) },
    });

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Milestones</h2>
        {canEdit && !adding && (
          <Button variant="ghost" size="sm" onClick={() => setAdding(true)}>
            <Plus className="size-3.5" />
            Add milestone
          </Button>
        )}
      </div>
      {milestones.length > 0 && (
        <ul className="flex flex-col">
          {milestones.map((m, i) => (
            <ProjectMilestoneRow
              key={m.id}
              projectId={project.id}
              milestone={m}
              canEdit={canEdit}
              onMoveUp={i > 0 ? () => move(i, i - 1) : undefined}
              onMoveDown={i < milestones.length - 1 ? () => move(i, i + 1) : undefined}
            />
          ))}
        </ul>
      )}
      {adding && (
        <ProjectMilestoneForm
          busy={create.isPending}
          onCancel={() => setAdding(false)}
          onSave={async (fields) => {
            await create.mutateAsync({
              ...fields,
              sortOrder: positionForMove(sortOrders, milestones.length, milestones.length, 1),
            });
            setAdding(false);
          }}
        />
      )}
    </section>
  );
}
