'use client';

import Link from 'next/link';
import type { TeamDetail } from '@/types/team';
import { initiativePath } from '@/utils/paths';
import { type InitiativeDetail } from '../services/initiatives.service';
import { type InitiativeUpdatesResult } from '../services/initiativeUpdates.service';
import InitiativeDescription from './InitiativeDescription';
import InitiativeProjects from './InitiativeProjects';
import InitiativeProperties from './InitiativeProperties';
import InitiativeSubInitiatives from './InitiativeSubInitiatives';
import InitiativeUpdates from './InitiativeUpdates';

// The initiative page body: summary, properties, overview, projects,
// sub-initiatives and updates.
export default function InitiativeOverview({
  initiative,
  updates,
  team,
}: {
  initiative: InitiativeDetail;
  updates: InitiativeUpdatesResult;
  team: TeamDetail;
}) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-8 py-8">
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold">{initiative.name}</h1>
        {initiative.description && (
          <p className="text-sm text-muted-foreground">{initiative.description}</p>
        )}
        {initiative.parent && (
          <p className="text-xs text-muted-foreground">
            Part of{' '}
            <Link
              href={initiativePath(team.team.key, initiative.parent.id)}
              className="hover:text-foreground hover:underline"
            >
              {initiative.parent.name}
            </Link>
          </p>
        )}
        <InitiativeProperties initiative={initiative} />
        <InitiativeDescription initiative={initiative} />
      </div>
      <InitiativeProjects initiative={initiative} teamKey={team.team.key} />
      <InitiativeSubInitiatives initiative={initiative} teamKey={team.team.key} />
      <InitiativeUpdates initiative={initiative} updates={updates} team={team} />
    </div>
  );
}
