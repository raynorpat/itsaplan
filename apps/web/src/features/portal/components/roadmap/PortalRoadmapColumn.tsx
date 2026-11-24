import Link from 'next/link';
import { statusLabel, voteLabel, type PortalIssue, type PublicStatus } from '../../utils/portal';

export default function PortalRoadmapColumn({
  slug,
  status,
  issues,
}: {
  slug: string;
  status: PublicStatus;
  issues: PortalIssue[];
}) {
  return (
    <section className="flex min-w-0 flex-col gap-2 rounded-lg bg-muted/50 p-3">
      <h2 className="flex items-baseline gap-2 px-1 text-sm font-medium">
        {statusLabel(status)}
        <span className="text-xs text-muted-foreground tabular-nums">{issues.length}</span>
      </h2>
      <ul className="flex flex-col gap-2">
        {issues.map((issue) => (
          <li key={issue.identifier}>
            <Link
              href={`/portal/${slug}/${issue.identifier}`}
              className="flex flex-col gap-1 rounded-md bg-card p-3 shadow-xs transition-colors hover:bg-accent"
            >
              <span className="text-sm font-medium">{issue.title}</span>
              <span className="text-xs text-muted-foreground">{voteLabel(issue.votes)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
