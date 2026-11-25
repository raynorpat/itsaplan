import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Minus } from 'lucide-react';
import type { Project } from '@/types/project';
import type { Assignee } from '@/types/team';
import { projectPath } from '@/utils/paths';
import { formatShortDate } from '@/utils/dates';
import { AssigneeAvatar } from '@/components/common/issue/IssueBadges';
import { PriorityIcon } from '@/components/common/issue/IssueIcons';
import { colorDot } from '@/components/common/fields/colorDot';
import { Button } from '@/components/ui/button';
import { TableCell, TableRow } from '@/components/ui/table';
import { STATUS_META } from '@/utils/projectMeta';
import HealthBadge from '@/components/common/updates/HealthBadge';
import ProgressRing from '../shared/ProgressRing';
import DependencyConflictIcon from '../shared/DependencyConflictIcon';

// The whole row navigates to the detail page; the title is also a real anchor so
// middle/cmd-click opens it in a new tab.
export default function ProjectRow({
  project,
  teamKey,
  owner,
  conflict = false,
  onRestore,
}: {
  project: Project;
  teamKey: string;
  owner: Assignee | null;
  // One of the project's dependencies has conflicting dates.
  conflict?: boolean;
  // A deleted project's row: Restore takes the place of the health.
  onRestore?: () => void;
}) {
  const router = useRouter();
  const href = projectPath(teamKey, project.id);

  return (
    <TableRow className="group/item cursor-pointer" onClick={() => router.push(href)}>
      <TableCell className="px-3 py-2.5 align-middle whitespace-normal">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="shrink-0">{colorDot(STATUS_META[project.status].color)}</span>
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-1.5">
              <Link
                href={href}
                onClick={(e) => e.stopPropagation()}
                className="block truncate text-sm font-medium hover:underline"
              >
                {project.name}
              </Link>
              {conflict && (
                <DependencyConflictIcon label="A dependency of this project has conflicting dates" />
              )}
            </div>
            {project.content && (
              <span className="block truncate text-xs text-muted-foreground">
                {project.content}
              </span>
            )}
          </div>
        </div>
      </TableCell>

      <TableCell className="px-3 py-2.5 align-middle">
        {project.priority ? (
          <span className="flex items-center gap-1.5 text-sm">
            <PriorityIcon priority={project.priority} className="size-3.5" />
            <span className="text-muted-foreground capitalize">{project.priority}</span>
          </span>
        ) : (
          <Minus className="size-3.5 text-muted-foreground" />
        )}
      </TableCell>

      <TableCell className="px-3 py-2.5 align-middle">
        {owner ? (
          <span className="flex items-center gap-1.5 text-sm">
            <AssigneeAvatar name={owner.name} image={owner.image} />
            <span className="truncate text-muted-foreground">{owner.name}</span>
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">Unassigned</span>
        )}
      </TableCell>

      <TableCell className="px-3 py-2.5 align-middle text-xs text-muted-foreground">
        {project.targetDate ? formatShortDate(project.targetDate) : '—'}
      </TableCell>

      <TableCell className="px-3 py-2.5 align-middle">
        <ProgressRing progress={project.progress} />
      </TableCell>

      <TableCell className="px-3 py-2.5 align-middle">
        {onRestore ? (
          <Button
            size="sm"
            variant="outline"
            onClick={(e) => {
              e.stopPropagation();
              onRestore();
            }}
          >
            Restore
          </Button>
        ) : (
          <HealthBadge health={project.health} />
        )}
      </TableCell>
    </TableRow>
  );
}
