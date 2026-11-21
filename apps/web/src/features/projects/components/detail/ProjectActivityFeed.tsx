'use client';

import { useProjectFeedQuery } from '@/services/projects.service';
import { Button } from '@/components/ui/button';
import ProjectFeedRow from './ProjectFeedRow';

// The project's activity: its own events plus its linked issues' activity, one
// feed paged newest first.
export default function ProjectActivityFeed({
  projectId,
  teamKey,
}: {
  projectId: string;
  teamKey: string;
}) {
  const feed = useProjectFeedQuery(projectId);

  // Pages can overlap when new activity shifts the offset, so drop repeated ids.
  const byId = new Map((feed.data?.pages ?? []).flatMap((p) => p.items).map((it) => [it.id, it]));
  const items = [...byId.values()];

  if (items.length === 0)
    return (
      <p className="text-sm text-muted-foreground">
        {feed.isLoading ? 'Loading…' : 'No activity yet.'}
      </p>
    );

  return (
    <>
      <ul className="flex flex-col gap-2.5">
        {items.map((item) => (
          <ProjectFeedRow key={item.id} item={item} teamKey={teamKey} />
        ))}
      </ul>
      {feed.hasNextPage && (
        <div className="mt-4">
          <Button
            variant="ghost"
            size="sm"
            disabled={feed.isFetchingNextPage}
            onClick={() => void feed.fetchNextPage()}
          >
            {feed.isFetchingNextPage ? 'Loading…' : 'Show more'}
          </Button>
        </div>
      )}
    </>
  );
}
