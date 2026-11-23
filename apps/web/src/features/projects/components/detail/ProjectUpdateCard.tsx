'use client';

import { useState } from 'react';
import { formatDistanceToNow, parseISO } from 'date-fns';
import type { TeamDetail } from '@/lib/api';
import { useSession } from '@/lib/auth-client';
import { qk } from '@/services/queryKeys';
import { useToggleReaction } from '@/services/reactions.service';
import Avatar from '@/components/common/Avatar';
import MarkdownEditor from '@/components/common/editor/MarkdownEditor';
import ReactionBar from '@/components/common/reactions/ReactionBar';
import HealthBadge from '../shared/HealthBadge';
import {
  useEditProjectUpdate,
  type ProjectUpdateItem,
} from '../../services/projectUpdates.service';
import ProjectUpdateActions from './ProjectUpdateActions';
import ProjectUpdateComments from './ProjectUpdateComments';
import ProjectUpdateForm from './ProjectUpdateForm';

// One project update: author, age, health and Markdown body; its reactions and
// comments below. The author edits or deletes it from the menu.
export default function ProjectUpdateCard({
  projectId,
  update,
  team,
}: {
  projectId: string;
  update: ProjectUpdateItem;
  team: TeamDetail;
}) {
  const viewerId = useSession().data?.user.id ?? null;
  const [editing, setEditing] = useState(false);
  const edit = useEditProjectUpdate(projectId);
  const toggle = useToggleReaction();
  const author = update.user?.name ?? 'a removed user';
  const image = team.assignees.find((a) => a.userId === update.user?.id)?.image ?? null;
  const own = viewerId != null && update.user?.id === viewerId;

  return (
    <li className="flex flex-col gap-3 rounded-lg border px-4 py-3">
      <div className="flex items-center gap-2">
        <Avatar name={author} image={image} className="size-6 text-[10px]" />
        <span className="text-sm font-medium">{author}</span>
        <span className="text-xs text-muted-foreground">
          {formatDistanceToNow(parseISO(update.createdAt), { addSuffix: true })}
          {update.editedAt && ' (edited)'}
        </span>
        <span className="ml-auto flex items-center gap-2">
          <HealthBadge health={update.health} />
          {own && (
            <ProjectUpdateActions
              projectId={projectId}
              updateId={update.id}
              onEdit={() => setEditing(true)}
            />
          )}
        </span>
      </div>
      {editing ? (
        <ProjectUpdateForm
          initial={{ body: update.body, health: update.health }}
          submitLabel="Save"
          busy={edit.isPending}
          onCancel={() => setEditing(false)}
          onSubmit={async (input) => {
            await edit.mutateAsync({ id: update.id, ...input });
            setEditing(false);
          }}
        />
      ) : (
        <MarkdownEditor
          key={update.editedAt ?? update.id}
          className="text-sm text-foreground/85"
          defaultValue={update.body}
          editable={false}
        />
      )}
      <ReactionBar
        reactions={update.reactions}
        viewerId={viewerId}
        pending={toggle.isPending}
        onToggle={(emoji, mineId) =>
          toggle.mutate({
            target: { projectUpdateId: update.id, refresh: qk.projectUpdates(projectId) },
            emoji,
            mineId,
          })
        }
      />
      <ProjectUpdateComments projectId={projectId} update={update} team={team} />
    </li>
  );
}
