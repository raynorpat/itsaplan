'use client';

import { Milestone, Plus } from 'lucide-react';
import { Pill } from '@/components/common/fields/Pill';
import PopoverPick from '@/components/common/fields/PopoverPick';
import { subInitiativeCandidates } from '../utils/initiativeLinks';
import { useInitiativesQuery } from '../services/initiatives.service';
import { useAddSubInitiative } from '../services/initiativeLinks.service';

// "Add sub-initiative": the initiatives that may become a child of this one (no
// parent yet, not this initiative or above it). The depth limit is checked by the
// API, whose message is shown when it refuses.
export default function InitiativeAddSubInitiative({ initiativeId }: { initiativeId: string }) {
  const all = useInitiativesQuery().data ?? [];
  const add = useAddSubInitiative(initiativeId);
  return (
    <PopoverPick
      trigger={
        <Pill>
          <Plus className="size-3.5" />
          Add sub-initiative
        </Pill>
      }
      inputPlaceholder="Add a sub-initiative…"
      emptyText="No initiatives to add."
      items={subInitiativeCandidates(all, initiativeId).map((i) => ({
        key: i.id,
        search: i.name,
        icon: <Milestone className="size-3.5" />,
        label: i.name,
        selected: false,
        onSelect: () => add.mutate(i.id),
      }))}
    />
  );
}
