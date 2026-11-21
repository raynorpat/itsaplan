import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { teamPath } from '@/utils/paths';

// The header title on an issue page: team name › issue identifier.
export default function IssueBreadcrumb({
  teamKey,
  teamName,
  identifier,
}: {
  teamKey: string | null;
  teamName: string;
  identifier: string | null;
}) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <Link
        href={teamKey ? teamPath(teamKey) : '/'}
        className="truncate text-muted-foreground hover:text-foreground"
      >
        {teamName}
      </Link>
      <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate font-medium">{identifier ?? '…'}</span>
    </span>
  );
}
