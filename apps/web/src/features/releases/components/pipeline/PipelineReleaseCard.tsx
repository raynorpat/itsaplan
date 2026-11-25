import Link from 'next/link';
import type { ReleaseListItem } from '@/services/releases.service';
import { formatDate } from '@/utils/dates';
import { releasePath } from '@/utils/paths';
import { releaseLabel } from '@/utils/releases';

// One release on a scheduled pipeline's board: its name, version, target date and
// issue count, linking to the release.
export default function PipelineReleaseCard({
  release,
  teamKey,
  pipelineSlug,
}: {
  release: ReleaseListItem;
  teamKey: string;
  pipelineSlug: string;
}) {
  return (
    <Link
      href={releasePath(teamKey, pipelineSlug, release.slugId)}
      className="flex flex-col gap-1 rounded-md border bg-card px-3 py-2 text-sm hover:bg-muted/50"
    >
      <span className="truncate font-medium">{releaseLabel(release)}</span>
      <span className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="truncate">
          {release.version && release.name ? release.version : ''}
          {release.targetDate
            ? `${release.version && release.name ? ' · ' : ''}Target ${formatDate(release.targetDate)}`
            : ''}
        </span>
        <span className="shrink-0 tabular-nums">
          {release.issueCount} {release.issueCount === 1 ? 'issue' : 'issues'}
        </span>
      </span>
    </Link>
  );
}
