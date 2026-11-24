import Link from 'next/link';
import { cycleLabel } from '@/utils/cycles';
import { cyclePath } from '@/utils/paths';
import { usePermissions } from '@/hooks/usePermissions';
import type { CycleListItem } from '../services/cycles.service';
import { canArchiveCycle } from '../utils/cycleActions';
import CycleDates from './CycleDates';
import CycleProgressBar from './CycleProgressBar';
import CycleRowMenu from './CycleRowMenu';

// One cycle in the cycles page's lists, linking to its page. A completed cycle has an
// options menu with Archive.
export default function CycleRow({
  cycle,
  percent,
  teamKey,
}: {
  cycle: CycleListItem;
  percent: number;
  teamKey: string;
}) {
  const { can } = usePermissions();
  const archivable = can('work_items', 'edit') && canArchiveCycle(cycle);
  return (
    <div className="flex items-center gap-2 border-b pr-4 text-sm last:border-b-0 hover:bg-muted/50">
      <Link
        href={cyclePath(teamKey, cycle.number)}
        className="flex min-w-0 flex-1 items-center gap-4 py-2.5 pl-6"
      >
        <span className="min-w-0 flex-1 truncate font-medium">{cycleLabel(cycle)}</span>
        <CycleDates startsAt={cycle.startsAt} endsAt={cycle.endsAt} />
        <CycleProgressBar percent={percent} />
      </Link>
      <div className="flex size-5 shrink-0 items-center justify-center">
        {archivable && <CycleRowMenu cycle={cycle} teamKey={teamKey} />}
      </div>
    </div>
  );
}
