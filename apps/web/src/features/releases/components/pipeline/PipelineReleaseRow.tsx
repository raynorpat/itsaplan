import Link from 'next/link';
import type { ReleaseListItem } from '@/services/releases.service';
import { formatDate } from '@/utils/dates';
import { releasePath } from '@/utils/paths';
import { releaseLabel } from '@/utils/releases';
import ReleaseStageBadge from '../ReleaseStageBadge';

// One release in a continuous pipeline's list: its name or version, stage, issue count
// and when it completed, linking to the release.
export default function PipelineReleaseRow({
  release,
  teamKey,
  pipelineSlug,
}: {
  release: ReleaseListItem;
  teamKey: string;
  pipelineSlug: string;
}) {
  const when = release.completedAt ?? release.createdAt;
  return (
    <Link
      href={releasePath(teamKey, pipelineSlug, release.slugId)}
      className="flex items-center gap-4 border-b px-6 py-2.5 text-sm last:border-b-0 hover:bg-muted/50"
    >
      <span className="min-w-0 flex-1 truncate font-medium">{releaseLabel(release)}</span>
      <ReleaseStageBadge stage={release.stage} />
      <span className="w-20 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
        {release.issueCount} {release.issueCount === 1 ? 'issue' : 'issues'}
      </span>
      <span className="w-28 shrink-0 text-right text-xs text-muted-foreground">
        {formatDate(when)}
      </span>
    </Link>
  );
}
