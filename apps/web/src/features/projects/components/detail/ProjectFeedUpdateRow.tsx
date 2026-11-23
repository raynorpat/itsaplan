'use client';

import Link from 'next/link';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { Megaphone } from 'lucide-react';
import { projectPath } from '@/utils/paths';
import { healthMeta } from '@/utils/projectMeta';
import type { ProjectUpdateNode } from '../../utils/projectFeed';

// A posted update in the project's activity: who posted it, its health, and a link
// to the Updates tab where it is read and discussed.
export default function ProjectFeedUpdateRow({
  update,
  projectId,
  teamKey,
}: {
  update: ProjectUpdateNode;
  projectId: string;
  teamKey: string;
}) {
  const { label, color } = healthMeta(update.health);
  return (
    <li className="flex items-center gap-2.5 text-xs">
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Megaphone className="size-3" />
      </span>
      <span className="min-w-0 text-muted-foreground">
        <span className="font-medium">{update.user?.name ?? 'a removed user'}</span>{' '}
        <Link
          href={projectPath(teamKey, projectId, 'updates')}
          className="text-foreground/70 hover:text-foreground"
        >
          posted an update
        </Link>{' '}
        <span style={{ color }}>· {label}</span>
        <span className="ml-1.5">
          · {formatDistanceToNow(parseISO(update.createdAt), { addSuffix: true })}
        </span>
      </span>
    </li>
  );
}
