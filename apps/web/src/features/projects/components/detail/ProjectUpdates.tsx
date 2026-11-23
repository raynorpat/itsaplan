'use client';

import type { TeamDetail } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import type { ProjectDetail } from '@/services/projects.service';
import {
  useCreateProjectUpdate,
  useProjectUpdatesQuery,
} from '../../services/projectUpdates.service';
import ProjectUpdateCard from './ProjectUpdateCard';
import ProjectUpdateForm from './ProjectUpdateForm';

// The Updates tab: a box to post an update with a health, then every update newest
// first, each with its reactions and comments.
export default function ProjectUpdates({
  project,
  team,
}: {
  project: ProjectDetail;
  team: TeamDetail;
}) {
  const canPost = usePermissions().can('projects', 'edit');
  const updates = useProjectUpdatesQuery(project.id);
  const create = useCreateProjectUpdate(project.id);
  const list = updates.data ?? [];

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-8 py-8">
      {canPost && (
        <ProjectUpdateForm
          initial={{ body: '', health: project.health ?? 'onTrack' }}
          submitLabel="Post update"
          busy={create.isPending}
          onSubmit={async (input) => {
            await create.mutateAsync(input);
          }}
        />
      )}
      {list.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {updates.isLoading ? 'Loading…' : 'No updates yet.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-4">
          {list.map((u) => (
            <ProjectUpdateCard key={u.id} projectId={project.id} update={u} team={team} />
          ))}
        </ul>
      )}
    </div>
  );
}
