'use client';

import { useShell } from '@/context/shellContext';
import { useLiveRefresh } from '@/hooks/useLiveRefresh';
import { qk } from '@/services/queryKeys';
import { cycleOptions, cyclesVisible } from '@/utils/cycles';
import { Button } from '@/components/ui/button';
import { useOpenCycles, usePastCycles, type CycleListItem } from './services/cycles.service';
import { shownCyclePercent } from './utils/cyclePage';
import CycleRow from './components/CycleRow';
import CyclesOffNotice from './components/CyclesOffNotice';
import CycleSection from './components/CycleSection';
import { usePastCyclesFollowOpen } from './hooks/usePastCyclesFollowOpen';

// A team's cycles: the current one, the upcoming ones soonest first, then the past
// ones newest first, a page at a time.
export default function CyclesPage() {
  const { team } = useShell();
  const on = cyclesVisible(team);
  const teamId = on ? (team?.team.id ?? null) : null;
  const open = useOpenCycles(teamId);
  const past = usePastCycles(teamId);
  useLiveRefresh({ targets: [qk.cycles(teamId ?? '', 'open')], enabled: teamId != null });
  usePastCyclesFollowOpen(
    teamId,
    open.data?.map((c) => c.id),
  );

  if (!team) return null;
  const teamKey = team.team.key;

  if (!on) return <CyclesOffNotice teamKey={teamKey} />;

  const now = new Date();
  const { current, upcoming } = cycleOptions(open.data ?? [], now);
  const percentOf = (c: CycleListItem) => shownCyclePercent(c, team, now);

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
