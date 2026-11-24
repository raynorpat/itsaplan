import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { issuePath, teamPath } from '@/utils/paths';
import { useSubIssuesQuery } from '@/services/issues.service';

// "MKT-42" → the issue page path.
function pathOf(identifier: string): string {
  const cut = identifier.lastIndexOf('-');
  return issuePath(identifier.slice(0, cut), Number(identifier.slice(cut + 1)));
}

// The header title on an issue page: team name › parent identifier (for a
// sub-issue) › issue identifier.
export default function IssueBreadcrumb({
  teamKey,
  teamName,
  issueId,
  identifier,
}: {
  teamKey: string | null;
  teamName: string;
  issueId: string | null;
  identifier: string | null;
}) {
  const parent = useSubIssuesQuery(issueId).data?.parent ?? null;
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <Link
        href={teamKey ? teamPath(teamKey) : '/'}
        className="truncate text-muted-foreground hover:text-foreground"
      >
        {teamName}
      </Link>
      <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
      {parent && (
        <>
          <Link
            href={pathOf(parent.identifier)}
            title={parent.title}
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            {parent.identifier}
          </Link>
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
        </>
      )}
      <span className="truncate font-medium">{identifier ?? '…'}</span>
    </span>
  );
}
