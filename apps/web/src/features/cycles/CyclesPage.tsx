'use client';

import Link from 'next/link';
import { useShell } from '@/context/shellContext';
import { usePermissions } from '@/hooks/usePermissions';
import { useLiveRefresh } from '@/hooks/useLiveRefresh';
import { qk } from '@/services/queryKeys';
import { cycleOptions, cyclesVisible } from '@/utils/cycles';
import { settingsPath } from '@/utils/paths';
import { Button } from '@/components/ui/button';
import { useOpenCycles, usePastCycles, type CycleSummary } from './services/cycles.service';
import { shownCycleProgress } from './utils/cyclePage';
import CycleRow from './components/CycleRow';
import CycleSection from './components/CycleSection';

// A team's cycles: the current one, the upcoming ones soonest first, then the past
// ones newest first, a page at a time.
export default function CyclesPage() {
  const { team } = useShell();
  const { canManage } = usePermissions();
  const on = cyclesVisible(team);
  const teamId = on ? (team?.team.id ?? null) : null;
  const open = useOpenCycles(teamId);
  const past = usePastCycles(teamId);
  useLiveRefresh({ targets: [qk.cycles(teamId ?? '', 'open')], enabled: teamId != null });

  if (!team) return null;
  const teamKey = team.team.key;

  if (!on)
    return (
      <div className="flex flex-col items-start gap-3 px-6 py-8 text-sm">
        <p className="text-muted-foreground">Cycles are turned off for this team.</p>
        {canManage && (
          <Button asChild size="sm" variant="outline">
            <Link href={settingsPath(teamKey, 'cycles')}>Turn on cycles</Link>
          </Button>
        )}
      </div>
    );

  const now = new Date();
  const { current, upcoming } = cycleOptions(open.data ?? [], now);
  const percentOf = (c: CycleSummary) => shownCycleProgress(c, team, now).percent;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <h1 className="px-6 py-4 text-lg font-semibold">Cycles</h1>
      {open.isLoading ? (
        <p className="px-6 text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="flex flex-col gap-6 pb-8">
          <CycleSection title="Current">
            {current ? (
              <CycleRow cycle={current} percent={percentOf(current)} teamKey={teamKey} />
            ) : (
              <p className="px-6 py-2.5 text-sm text-muted-foreground">No cycle is running.</p>
            )}
          </CycleSection>
          {upcoming.length > 0 && (
            <CycleSection title="Upcoming">
              {upcoming.map((c) => (
                <CycleRow key={c.id} cycle={c} percent={percentOf(c)} teamKey={teamKey} />
              ))}
            </CycleSection>
          )}
          {past.items.length > 0 && (
            <CycleSection title="Past">
              {past.items.map((c) => (
                <CycleRow key={c.id} cycle={c} percent={percentOf(c)} teamKey={teamKey} />
              ))}
              {past.hasNextPage && (
                <div className="px-6 py-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={past.isFetchingNextPage}
                    onClick={() => void past.fetchNextPage()}
                  >
                    {past.isFetchingNextPage ? 'Loading…' : 'Load more'}
                  </Button>
                </div>
              )}
            </CycleSection>
          )}
        </div>
      )}
    </div>
  );
}
