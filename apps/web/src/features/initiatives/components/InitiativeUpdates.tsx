'use client';

import type { UseQueryResult } from '@tanstack/react-query';
import type { TeamDetail } from '@/lib/api';
import UpdateForm from '@/components/common/updates/UpdateForm';
import { type InitiativeDetail } from '../services/initiatives.service';
import {
  useCreateInitiativeUpdate,
  type InitiativeUpdateItem,
} from '../services/initiativeUpdates.service';
import InitiativeSection from './InitiativeSection';
import InitiativeUpdateCard from './InitiativeUpdateCard';

// The initiative's updates: a box to post one with a health, then the latest 50
// newest first, each with its reactions and comments.
export default function InitiativeUpdates({
  initiative,
  updates,
  team,
}: {
  initiative: InitiativeDetail;
  updates: UseQueryResult<InitiativeUpdateItem[]>;
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
        </ul>
      )}
    </InitiativeSection>
  );
}
