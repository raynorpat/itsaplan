'use client';

import { Flag } from 'lucide-react';
import { useProjectMilestonesQuery } from '@/services/projects.service';

// The project's milestones, read-only (they are created and edited over the API).
export default function ProjectMilestones({ projectId }: { projectId: string }) {
  const { data: milestones } = useProjectMilestonesQuery(projectId);
  if (!milestones || milestones.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium">Milestones</h2>
      <ul className="flex flex-col gap-1">
        {milestones.map((m) => (
          <li key={m.id} className="flex items-center gap-2 text-sm">
            <Flag className="size-3.5 text-muted-foreground" />
            <span className="flex-1 truncate">{m.name}</span>
            {m.targetDate && <span className="text-xs text-muted-foreground">{m.targetDate}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
