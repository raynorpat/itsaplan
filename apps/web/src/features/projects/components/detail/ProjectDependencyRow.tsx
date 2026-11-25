'use client';

import Link from 'next/link';
import { X } from 'lucide-react';
import { projectPath } from '@/utils/paths';
import { isConflict, type ProjectRelationItem } from '@/utils/projectRelations';
import { useDeleteProjectRelation } from '@/services/projectRelations.service';
import { dependencyText } from '../../utils/dependencyText';
import DependencyConflictIcon from '../shared/DependencyConflictIcon';

// One dependency of the project: the other project, the two anchors in words, a
// warning when the dates conflict, and Remove for people who can edit.
export default function ProjectDependencyRow({
  relation,
  projectId,
  teamKey,
  canEdit,
}: {
  relation: ProjectRelationItem;
  projectId: string;
  teamKey: string;
  canEdit: boolean;
}) {
  const remove = useDeleteProjectRelation();
  const other = relation.from.projectId === projectId ? relation.to : relation.from;

  return (
    <li className="group flex items-center gap-2 py-1 text-sm">
      <Link
        href={projectPath(teamKey, other.projectId)}
        className="min-w-0 truncate font-medium hover:underline"
      >
        {other.projectName}
      </Link>
      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
        {dependencyText(relation, projectId)}
      </span>
      {isConflict(relation) && (
        <DependencyConflictIcon label="The dates conflict: the blocking date is after the blocked date" />
      )}
      {canEdit && (
        <button
          type="button"
          aria-label={`Remove dependency on ${other.projectName}`}
          className="rounded p-0.5 text-muted-foreground/60 hover:text-foreground"
          disabled={remove.isPending}
          onClick={() => remove.mutate(relation.id)}
        >
          <X className="size-3.5" />
        </button>
      )}
    </li>
  );
}
