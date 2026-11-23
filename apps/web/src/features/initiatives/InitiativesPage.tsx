'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useShell } from '@/context/shellContext';
import { usePermissions } from '@/hooks/usePermissions';
import { canSeeInitiatives } from '@/utils/workspaceRoles';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useInitiativesQuery } from './services/initiatives.service';
import { OFFERED_STATUSES, type InitiativeStatus } from './utils/initiativeMeta';
import CreateInitiativeDialog from './components/CreateInitiativeDialog';
import InitiativesList from './components/InitiativesList';

type Tab = 'all' | InitiativeStatus;

// The workspace's initiatives, one status tab at a time (All, Planned, Active,
// Completed). Every initiative loads at once and the tabs filter it in the browser.
// Guests have no initiatives.
export default function InitiativesPage() {
  const { team } = useShell();
  const { workspaceRole } = usePermissions();
  const visible = canSeeInitiatives(workspaceRole);
  const query = useInitiativesQuery(visible);
  const [tab, setTab] = useState<Tab>('all');
  const [creating, setCreating] = useState(false);

  if (!team) return null;
  if (!visible)
    return <p className="px-6 py-8 text-sm text-muted-foreground">Initiatives not found.</p>;

  const all = query.data ?? [];
  const shown = tab === 'all' ? all : all.filter((i) => i.status === tab);
  const count = (t: Tab) => (t === 'all' ? all.length : all.filter((i) => i.status === t).length);

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div className="flex items-center justify-between px-4 py-3">
        <h1 className="text-lg font-semibold">Initiatives</h1>
        <Button size="sm" className="h-8 gap-1.5" onClick={() => setCreating(true)}>
          <Plus className="size-3.5" />
          New initiative
        </Button>
      </div>
      <div className="px-4 pb-2">
        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
          <TabsList variant="line">
            {(['all', ...OFFERED_STATUSES] as Tab[]).map((t) => (
              <TabsTrigger key={t} value={t}>
                {t === 'all' ? 'All' : t}
                {query.data && (
                  <span className="ml-1.5 text-xs text-muted-foreground">{count(t)}</span>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      <InitiativesList
        initiatives={shown}
        teamKey={team.team.key}
        isLoading={query.isLoading}
        onCreate={() => setCreating(true)}
      />
      {creating && (
        <CreateInitiativeDialog teamKey={team.team.key} onClose={() => setCreating(false)} />
      )}
    </div>
  );
}
