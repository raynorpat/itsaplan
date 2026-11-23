'use client';

import Link from 'next/link';
import { formatDistanceToNow, parseISO } from 'date-fns';
import type { ProjectDetail } from '@/services/projects.service';
import { projectPath } from '@/utils/paths';
import MarkdownEditor from '@/components/common/editor/MarkdownEditor';
import HealthBadge from '../shared/HealthBadge';

// The project's latest update on the overview: its health, author, age and body,
// with a link to every update.
export default function ProjectLatestUpdate({
  project,
  teamKey,
}: {
  project: ProjectDetail;
  teamKey: string;
}) {
  const update = project.latestUpdate;
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-medium">Latest update</h2>
        <Link
          href={projectPath(teamKey, project.id, 'updates')}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          {update ? 'All updates' : 'Post an update'}
        </Link>
      </div>
      {update ? (
        <div className="rounded-lg border px-4 py-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <HealthBadge health={update.health} />
            <span>
              {update.user?.name ?? 'a removed user'} ·{' '}
              {formatDistanceToNow(parseISO(update.createdAt), { addSuffix: true })}
            </span>
          </div>
          <MarkdownEditor
            key={update.id}
            className="mt-2 text-sm text-foreground/85"
            defaultValue={update.body}
            editable={false}
          />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No updates yet.</p>
      )}
    </section>
  );
}
