'use client';

import { useParams } from 'next/navigation';
import { Skeleton } from '@/components/ui/skeleton';
import { usePortalBoard, usePortalIssues } from './services/portal.service';
import { PUBLIC_STATUSES, roadmapColumns } from './utils/portal';
import PortalRoadmapColumn from './components/roadmap/PortalRoadmapColumn';

// /portal/<slug>/roadmap: the board's issues in Planned, In progress and Done.
export default function PortalRoadmapPage() {
  const { slug } = useParams<{ slug: string }>();
  const board = usePortalBoard(slug).data;
  const issues = usePortalIssues(slug, 'top', '', !!board?.canRead);
  if (!board) return null;
  if (issues.isPending) return <Skeleton className="h-64 w-full" />;
  const columns = roadmapColumns(issues.data ?? []);
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {PUBLIC_STATUSES.map((status) => (
        <PortalRoadmapColumn key={status} slug={slug} status={status} issues={columns[status]} />
      ))}
    </div>
  );
}
