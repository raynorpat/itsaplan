'use client';

import type { TeamDetail } from '@/types/team';
import { useCommentContext } from '@/hooks/useCommentContext';
import { Button } from '@/components/ui/button';
import CommentComposer from '@/components/common/comments/CommentComposer';
import CommentThread from '@/components/common/comments/CommentThread';
import { useProjectActivityQuery } from '../../services/projectActivity.service';
import ProjectFeedRow from './ProjectFeedRow';
import ProjectFeedUpdateRow from './ProjectFeedUpdateRow';

// The project's activity: a comment box, then its changes, comment threads and
// posted updates, newest first.
export default function ProjectActivityFeed({
  projectId,
  team,
}: {
  projectId: string;
  team: TeamDetail;
}) {
  const target = { projectId };
  const ctx = useCommentContext(target, team.assignees);
  const activity = useProjectActivityQuery(projectId);
  const entries = activity.data ?? [];
  const imageByUserId = new Map(team.assignees.map((a) => [a.userId, a.image]));

  return (
    <div className="flex flex-col gap-4">
      <CommentComposer
        target={target}
        assignees={team.assignees}
        authorName={ctx.authorName}
        authorImage={ctx.authorImage}
      />
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {activity.isLoading ? 'Loading…' : 'No activity yet.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {entries.map((entry) => {
            switch (entry.kind) {
              case 'history':
                return <ProjectFeedRow key={entry.id} entry={entry} />;
              case 'update':
                return (
                  <ProjectFeedUpdateRow
                    key={entry.id}
                    update={entry.update}
                    projectId={projectId}
                    teamKey={team.team.key}
                  />
                );
              default:
                return (
                  <CommentThread
                    key={entry.id}
                    entry={entry.thread}
                    imageByUserId={imageByUserId}
                    ctx={ctx}
                  />
                );
            }
          })}
          {activity.hasOlder && (
            <li>
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                disabled={activity.loadingOlder}
                onClick={activity.loadOlder}
              >
                {activity.loadingOlder ? 'Loading…' : 'Show older'}
              </Button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
