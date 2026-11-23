'use client';

import { useState } from 'react';
import { PencilIcon } from 'lucide-react';
import { cycleLabel } from '@/utils/cycles';
import { Button } from '@/components/ui/button';
import type { CycleSummary } from '../services/cycles.service';
import { chartPoints, cycleProgress } from '../utils/cyclePage';
import CycleChart from './CycleChart';
import CycleDates from './CycleDates';
import CycleEditDialog from './CycleEditDialog';
import CycleProgressBar from './CycleProgressBar';

const DAY_MS = 24 * 60 * 60 * 1000;

// A cycle's name, dates, description, progress numbers and chart.
export default function CycleHeader({
  cycle,
  teamKey,
  teamId,
}: {
  cycle: CycleSummary;
  teamKey: string;
  teamId: string;
}) {
  const [editing, setEditing] = useState(false);
  const progress = cycleProgress(cycle);
  const days = Math.round(
    (new Date(cycle.endsAt).getTime() - new Date(cycle.startsAt).getTime()) / DAY_MS,
  );

  return (
    <header className="flex flex-col gap-3 border-b px-6 py-4">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold">{cycleLabel(cycle)}</h1>
        <CycleDates startsAt={cycle.startsAt} endsAt={cycle.endsAt} />
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Edit cycle"
          onClick={() => setEditing(true)}
        >
          <PencilIcon />
        </Button>
      </div>
      {cycle.description && (
        <p className="text-sm whitespace-pre-wrap text-muted-foreground">{cycle.description}</p>
      )}
      <div className="flex flex-wrap items-start gap-8">
        <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Progress</dt>
          <dd>
            <CycleProgressBar percent={progress.percent} />
          </dd>
          <dt className="text-muted-foreground">Scope</dt>
          <dd className="tabular-nums">{progress.scope}</dd>
          <dt className="text-muted-foreground">Started</dt>
          <dd className="tabular-nums">{progress.started}</dd>
          <dt className="text-muted-foreground">Completed</dt>
          <dd className="tabular-nums">{progress.completed}</dd>
        </dl>
        <CycleChart points={chartPoints(cycle)} days={days} />
      </div>
      {editing && (
        <CycleEditDialog
          cycle={cycle}
          teamKey={teamKey}
          teamId={teamId}
          onClose={() => setEditing(false)}
        />
      )}
    </header>
  );
}
