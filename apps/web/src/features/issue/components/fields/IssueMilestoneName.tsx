'use client';

import { useProjectMilestonesQuery } from '@/services/projects.service';

// The issue's project milestone, read-only (milestones are set over the API).
export default function IssueMilestoneName({
  projectId,
  milestoneId,
}: {
  projectId: string;
  milestoneId: string;
}) {
  const { data } = useProjectMilestonesQuery(projectId);
  const name = data?.find((m) => m.id === milestoneId)?.name;
  return <span className="truncate text-sm">{name ?? '…'}</span>;
}
