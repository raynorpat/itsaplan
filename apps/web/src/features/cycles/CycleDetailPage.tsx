'use client';

import { useParams } from 'next/navigation';
import { useShell } from '@/context/shellContext';
import { useLiveRefresh } from '@/hooks/useLiveRefresh';
import { qk } from '@/services/queryKeys';
import { cyclesVisible } from '@/utils/cycles';
import { useCycleByNumber } from './services/cycles.service';
import CycleArchivedIssues from './components/CycleArchivedIssues';
import CycleHeader from './components/CycleHeader';
import CycleIssuesBoard from './components/CycleIssuesBoard';
import { shownCycleProgress } from './utils/cyclePage';

// One cycle of a team, by its number: the header with progress and chart, then its
// issues on the board. A past cycle also lists its archived issues.
export default function CycleDetailPage() {
  const { team } = useShell();
  const params = useParams();
  const raw = Array.isArray(params.number) ? params.number[0] : params.number;
  const number = Number(raw);
  const teamId = cyclesVisible(team) ? (team?.team.id ?? null) : null;
  const query = useCycleByNumber(teamId, number);
  useLiveRefresh({ targets: [qk.cycle(teamId ?? '', number)], enabled: teamId != null });

  if (!team) return null;
  const cycle = query.data;
  if (!cycle)
    return (
      <p className="px-6 py-8 text-sm text-muted-foreground">
        {query.isLoading ? 'Loading…' : 'Cycle not found.'}
      </p>
    );

  const isPast = new Date(cycle.endsAt).getTime() <= Date.now();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <CycleHeader
        cycle={cycle}
        progress={shownCycleProgress(cycle, team, new Date())}
        teamKey={team.team.key}
        teamId={team.team.id}
      />
      <CycleIssuesBoard cycleId={cycle.id} />
      {isPast && <CycleArchivedIssues cycleId={cycle.id} />}
    </div>
  );
}
