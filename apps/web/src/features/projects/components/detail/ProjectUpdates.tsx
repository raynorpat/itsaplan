'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import type { TeamDetail } from '@/types/team';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useViewerWorkspaceQuery } from '@/services/viewer.service';
import type { ProjectDetail } from '@/services/projects.service';
import {
  useCreateProjectUpdate,
  useProjectUpdatesQuery,
  useShareProjectUpdate,
  useSharedProjectUpdatesQuery,
} from '../../services/projectUpdates.service';
import ProjectUpdateCard from './ProjectUpdateCard';
import UpdateForm from '@/components/common/updates/UpdateForm';

// The Updates tab: a box to post an update with a health (anyone who sees the
// project may post) and, for members, "Send to requesters" (off by default: updates
// are often written for the team), then the updates newest first (a page at a time),
// each with its reactions and comments. An update not sent can be sent later from its
// menu.
export default function ProjectUpdates({
  project,
  team,
}: {
  project: ProjectDetail;
  team: TeamDetail;
}) {
  const updates = useProjectUpdatesQuery(project.id);
  const create = useCreateProjectUpdate(project.id);
  const share = useShareProjectUpdate(project.id);
  const viewer = useViewerWorkspaceQuery();
  const role = viewer.data?.workspaceRole ?? null;
  const canShare = role != null && role !== 'guest';
  const shared = useSharedProjectUpdatesQuery(project.id, canShare);
  const [sendToRequesters, setSendToRequesters] = useState(false);
  const list = updates.data ?? [];

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-8 py-8">
      <UpdateForm
        initial={{ body: '', health: project.health ?? 'onTrack' }}
        submitLabel="Post update"
        busy={create.isPending || share.isPending}
        onSubmit={async (input) => {
          const posted = await create.mutateAsync(input);
          const id = posted.projectUpdateCreate.projectUpdate?.id;
          if (sendToRequesters && id) {
            await share.mutateAsync(id);
            toast.success('The update will be emailed to requesters');
          }
          setSendToRequesters(false);
        }}
        extra={
          canShare && (
            <div className="flex items-center gap-2">
              <Switch
                id="update-send-to-requesters"
                size="sm"
                checked={sendToRequesters}
                onCheckedChange={setSendToRequesters}
              />
              <Label htmlFor="update-send-to-requesters" className="text-xs font-normal">
                Send to requesters
              </Label>
            </div>
          )
        }
      />
      {list.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {updates.isLoading ? 'Loading…' : 'No updates yet.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-4">
          {list.map((u) => (
            <ProjectUpdateCard
              key={u.id}
              projectId={project.id}
              update={u}
              team={team}
              role={role}
              shared={shared.data?.has(u.id) ?? true}
            />
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
