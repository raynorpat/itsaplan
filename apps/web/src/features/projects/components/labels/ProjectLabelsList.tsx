'use client';

import { useProjectLabelsQuery } from '../../services/projectLabels.service';
import ProjectLabelRow from './ProjectLabelRow';

// The project labels, one editable row each.
export default function ProjectLabelsList({ canManage }: { canManage: boolean }) {
  const { data: labels, isLoading } = useProjectLabelsQuery();
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const applicable = (labels ?? []).filter((l) => !l.isGroup);
  if (applicable.length === 0)
    return <p className="text-sm text-muted-foreground">No project labels yet.</p>;
  return (
    <ul className="flex max-w-xl flex-col divide-y rounded-md border">
      {applicable.map((label) => (
        <ProjectLabelRow key={label.id} label={label} canManage={canManage} />
      ))}
    </ul>
  );
}
