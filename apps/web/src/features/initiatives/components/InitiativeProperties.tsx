'use client';

import AssigneeSelect from '@/components/common/fields/AssigneeSelect';
import DatePill from '@/components/common/fields/DatePill';
import {
  useUpdateInitiative,
  type InitiativeChange,
  type InitiativeDetail,
} from '../services/initiatives.service';
import { useInitiativeOwnersQuery } from '../services/initiativeLinks.service';
import InitiativeLeadTeamSelect from './InitiativeLeadTeamSelect';
import InitiativeStatusSelect from './InitiativeStatusSelect';

// The initiative's properties as pills, each saved through initiativeUpdate as it is
// picked. Anyone who sees an initiative may change it.
export default function InitiativeProperties({ initiative }: { initiative: InitiativeDetail }) {
  const update = useUpdateInitiative(initiative.id);
  const owners = useInitiativeOwnersQuery(initiative.leadTeam?.id ?? null).data ?? [];
  const patch = (change: InitiativeChange) => update.mutate(change);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <InitiativeStatusSelect value={initiative.status} onChange={(status) => patch({ status })} />
      <AssigneeSelect
        assignees={owners}
        value={initiative.owner?.id ?? null}
        onChange={(ownerId) => patch({ ownerId })}
        placeholder="No owner"
      />
      <DatePill
        value={initiative.targetDate}
        placeholder="Target date"
        onChange={(targetDate) => patch({ targetDate })}
      />
      <InitiativeLeadTeamSelect
        value={initiative.leadTeam}
        onChange={(leadTeamId) => patch({ leadTeamId })}
      />
    </div>
  );
}
