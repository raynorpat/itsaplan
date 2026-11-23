'use client';

import type { TeamDetail } from '@/types/team';
import { Button } from '@/components/ui/button';
import UpdateForm from '@/components/common/updates/UpdateForm';
import { type InitiativeDetail } from '../services/initiatives.service';
import {
  useCreateInitiativeUpdate,
  type InitiativeUpdatesResult,
} from '../services/initiativeUpdates.service';
import InitiativeSection from './InitiativeSection';
import InitiativeUpdateCard from './InitiativeUpdateCard';

// The initiative's updates: a box to post one with a health, then the updates
// newest first (a page at a time), each with its reactions and comments.
export default function InitiativeUpdates({
  initiative,
  updates,
  team,
}: {
  initiative: InitiativeDetail;
  updates: InitiativeUpdatesResult;
  team: TeamDetail;
}) {
  const create = useCreateInitiativeUpdate(initiative.id);
  const list = updates.data ?? [];
  return (
    <InitiativeSection title="Updates">
      <UpdateForm
        initial={{ body: '', health: initiative.health ?? 'onTrack' }}
        submitLabel="Post update"
        busy={create.isPending}
        onSubmit={async (input) => {
          await create.mutateAsync(input);
        }}
      />
      {list.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {updates.isLoading ? 'Loading…' : 'No updates yet.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-4">
          {list.map((u) => (
            <InitiativeUpdateCard key={u.id} initiativeId={initiative.id} update={u} team={team} />
          ))}
          {updates.hasOlder && (
            <li>
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                disabled={updates.loadingOlder}
                onClick={updates.loadOlder}
              >
                {updates.loadingOlder ? 'Loading…' : 'Show older'}
              </Button>
            </li>
          )}
        </ul>
      )}
    </InitiativeSection>
  );
}
