'use client';

import type { TeamDetail } from '@/lib/api';
import { Button } from '@/components/ui/button';
import type { ProjectDetail } from '@/services/projects.service';
import {
  useCreateProjectUpdate,
  useProjectUpdatesQuery,
} from '../../services/projectUpdates.service';
import ProjectUpdateCard from './ProjectUpdateCard';
import UpdateForm from '@/components/common/updates/UpdateForm';

// The Updates tab: a box to post an update with a health (anyone who sees the
// project may post), then the updates newest first (a page at a time), each with
// its reactions and comments.
export default function ProjectUpdates({
  project,
  team,
}: {
  project: ProjectDetail;
  team: TeamDetail;
}) {
  const updates = useProjectUpdatesQuery(project.id);
  const create = useCreateProjectUpdate(project.id);
  const list = updates.data ?? [];

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-8 py-8">
      <UpdateForm
        initial={{ body: '', health: project.health ?? 'onTrack' }}
        submitLabel="Post update"
        busy={create.isPending}
        onSubmit={async (input) => {
          await create.mutateAsync(input);
        }}
      />
      {list.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {updates.isLoading ? 'Loading…' : 'No updates yet.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-4">
          {list.map((u) => (
            <ProjectUpdateCard key={u.id} projectId={project.id} update={u} team={team} />
          ))}
          {updates.hasOlder && (
            <li>
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                disabled={updates.loadingOlder}
                onClick={updates.loadOlder}
              >
                {updates.loadingOlder ? 'Loading…' : 'Show older'}
              </Button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
