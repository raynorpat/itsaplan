'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { initiativePath } from '@/utils/paths';
import { formatShortDate } from '@/utils/dates';
import Avatar from '@/components/common/Avatar';
import { colorDot } from '@/components/common/fields/colorDot';
import HealthBadge from '@/components/common/updates/HealthBadge';
import { TableCell, TableRow } from '@/components/ui/table';
import { type InitiativeSummary } from '../services/initiatives.service';
import { INITIATIVE_STATUS_META } from '../utils/initiativeMeta';

// One initiative in the list. The whole row opens it; the name is also a link, so
// middle/cmd-click opens it in a new tab.
export default function InitiativeRow({
  initiative,
  teamKey,
}: {
  initiative: InitiativeSummary;
  teamKey: string;
}) {
  const router = useRouter();
  const href = initiativePath(teamKey, initiative.id);
  const status = INITIATIVE_STATUS_META[initiative.status];

  return (
    <TableRow className="cursor-pointer" onClick={() => router.push(href)}>
      <TableCell className="px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="shrink-0" title={status.label}>
            {colorDot(status.color)}
          </span>
          <Link
            href={href}
            onClick={(e) => e.stopPropagation()}
            className="truncate text-sm font-medium hover:underline"
          >
            {initiative.name}
          </Link>
          <span className="shrink-0 text-xs text-muted-foreground">{status.label}</span>
        </div>
      </TableCell>
      <TableCell className="px-3 py-2.5">
        <HealthBadge health={initiative.health} />
      </TableCell>
      <TableCell className="px-3 py-2.5">
        {initiative.owner ? (
          <span className="flex min-w-0 items-center gap-2 text-sm">
            <Avatar
              name={initiative.owner.name}
              image={initiative.owner.image}
              className="size-5 text-[9px]"
            />
            <span className="truncate">{initiative.owner.name}</span>
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">No owner</span>
        )}
      </TableCell>
      <TableCell className="px-3 py-2.5 text-sm text-muted-foreground">
        {initiative.targetDate ? formatShortDate(initiative.targetDate) : '—'}
      </TableCell>
      <TableCell className="px-3 py-2.5 text-sm text-muted-foreground">
        {initiative.projectCount}
      </TableCell>
    </TableRow>
  );
}
