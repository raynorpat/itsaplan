'use client';

import { useParams } from 'next/navigation';
import { useShell } from '@/context/shellContext';
import { useLiveRefresh } from '@/hooks/useLiveRefresh';
import { usePermissions } from '@/hooks/usePermissions';
import { qk } from '@/services/queryKeys';
import { canSeeInitiatives } from '@/utils/workspaceRoles';
import { useInitiativeQuery } from './services/initiatives.service';
import { useInitiativeUpdatesQuery } from './services/initiativeUpdates.service';
import InitiativeHeader from './components/InitiativeHeader';
import InitiativeOverview from './components/InitiativeOverview';

// One initiative: a header with its health and menu, then its overview, properties,
// projects, sub-initiatives and updates on one page. A guest, or anyone the
// initiative is hidden from, gets "not found".
export default function InitiativeDetailPage() {
  const { team } = useShell();
  const params = useParams();
  const raw = Array.isArray(params.initiativeId) ? params.initiativeId[0] : params.initiativeId;
  const id = raw ?? '';
  const visible = canSeeInitiatives(usePermissions().workspaceRole);

  const query = useInitiativeQuery(id, visible && id !== '');
  const updates = useInitiativeUpdatesQuery(id, visible && id !== '');
  useLiveRefresh({
    targets: [qk.initiative(id), qk.initiativeUpdates(id)],
    enabled: visible && id !== '',
  });

  if (!team) return null;
  const initiative = query.data;
  if (!initiative)
    return (
      <p className="px-6 py-8 text-sm text-muted-foreground">
        {visible && query.isLoading ? 'Loading…' : 'Initiative not found.'}
      </p>
    );

  // The loaded updates are newest first; undefined while they load.
  const latestUpdate = updates.data === undefined ? undefined : (updates.data[0] ?? null);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <InitiativeHeader
        initiative={initiative}
        latestUpdate={latestUpdate}
        teamKey={team.team.key}
      />
      <div className="flex-1 overflow-y-auto">
        <InitiativeOverview initiative={initiative} updates={updates} team={team} />
      </div>
    </div>
  );
}
