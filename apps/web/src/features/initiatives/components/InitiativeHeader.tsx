'use client';

import type { ProjectHealth } from '@/types/project';
import { shownHealth } from '@/utils/health';
import HealthBadge from '@/components/common/updates/HealthBadge';
import { type InitiativeDetail } from '../services/initiatives.service';
import InitiativeActions from './InitiativeActions';

// The initiative's name, an "Archived" mark, the health of its latest update and
// its menu.
export default function InitiativeHeader({
  initiative,
  latestUpdate,
  teamKey,
}: {
  initiative: InitiativeDetail;
  latestUpdate: { health: ProjectHealth } | null | undefined;
  teamKey: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2 border-b px-6 py-2.5">
      <span className="flex min-w-0 items-center gap-2">
        <span className="truncate text-sm font-semibold">{initiative.name}</span>
        {initiative.archivedAt && <span className="text-xs text-muted-foreground">Archived</span>}
      </span>
      <div className="flex shrink-0 items-center gap-3">
        <HealthBadge health={shownHealth(initiative, latestUpdate)} />
        <InitiativeActions initiative={initiative} teamKey={teamKey} />
      </div>
    </div>
  );
}
