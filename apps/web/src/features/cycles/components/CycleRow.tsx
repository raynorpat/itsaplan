import Link from 'next/link';
import { cycleLabel } from '@/utils/cycles';
import { cyclePath } from '@/utils/paths';
import type { CycleSummary } from '../services/cycles.service';
import { cycleProgress } from '../utils/cyclePage';
import CycleDates from './CycleDates';
import CycleProgressBar from './CycleProgressBar';

// One cycle in the cycles page's lists, linking to its page.
export default function CycleRow({ cycle, teamKey }: { cycle: CycleSummary; teamKey: string }) {
  return (
    <Link
      href={cyclePath(teamKey, cycle.number)}
      className="flex items-center gap-4 border-b px-6 py-2.5 text-sm last:border-b-0 hover:bg-muted/50"
    >
      <span className="min-w-0 flex-1 truncate font-medium">{cycleLabel(cycle)}</span>
      <CycleDates startsAt={cycle.startsAt} endsAt={cycle.endsAt} />
      <CycleProgressBar percent={cycleProgress(cycle).percent} />
    </Link>
  );
}
