'use client';

import { useState } from 'react';
import type { TeamDetail } from '@/types/team';
import { useCommentContext } from '@/hooks/useCommentContext';
import { Button } from '@/components/ui/button';
import CommentComposer from '@/components/common/comments/CommentComposer';
import CommentThread from '@/components/common/comments/CommentThread';
import type { ProjectUpdateItem } from '../../services/projectUpdates.service';

// The comment threads on one update, and a comment box opened by "Comment".
export default function ProjectUpdateComments({
  projectId,
  update,
  team,
}: {
  projectId: string;
  update: ProjectUpdateItem;
  team: TeamDetail;
}) {
  const [composing, setComposing] = useState(false);
  const target = { projectUpdateId: update.id, projectId };
  const ctx = useCommentContext(target, team.assignees);
  const imageByUserId = new Map(team.assignees.map((a) => [a.userId, a.image]));

  return (
    <div className="flex flex-col gap-2.5 border-t pt-3">
      {update.threads.length > 0 && (
        <ul className="flex flex-col gap-2.5">
          {update.threads.map((entry) => (
            <CommentThread
              key={entry.item.id}
              entry={entry}
              imageByUserId={imageByUserId}
              ctx={ctx}
            />
          ))}
        </ul>
      )}
      {composing ? (
        <CommentComposer
          target={target}
          assignees={team.assignees}
          authorName={ctx.authorName}
          authorImage={ctx.authorImage}
          onDone={() => setComposing(false)}
        />
      ) : (
        <Button variant="ghost" size="sm" className="self-start" onClick={() => setComposing(true)}>
          Comment
        </Button>
      )}
    </div>
  );
}
