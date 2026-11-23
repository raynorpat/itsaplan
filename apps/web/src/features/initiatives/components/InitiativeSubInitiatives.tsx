'use client';

import { initiativePath } from '@/utils/paths';
import { childRelations } from '../utils/initiativeLinks';
import { INITIATIVE_STATUS_META } from '../utils/initiativeMeta';
import { type InitiativeDetail } from '../services/initiatives.service';
import {
  useInitiativeRelationsQuery,
  useRemoveSubInitiative,
} from '../services/initiativeLinks.service';
import InitiativeAddSubInitiative from './InitiativeAddSubInitiative';
import InitiativeLinkedRow from './InitiativeLinkedRow';
import InitiativeSection from './InitiativeSection';

// The initiative's direct sub-initiatives, each removable, and a picker to add one.
export default function InitiativeSubInitiatives({
  initiative,
  teamKey,
}: {
  initiative: InitiativeDetail;
  teamKey: string;
}) {
  const relations = childRelations(useInitiativeRelationsQuery().data ?? [], initiative.id);
  const remove = useRemoveSubInitiative();
  return (
    <InitiativeSection
      title="Sub-initiatives"
      action={<InitiativeAddSubInitiative initiativeId={initiative.id} />}
    >
      {initiative.subInitiatives.length === 0 ? (
        <p className="text-sm text-muted-foreground">No sub-initiatives.</p>
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border">
          {initiative.subInitiatives.map((s) => {
            const relationId = relations.get(s.id);
            return (
              <InitiativeLinkedRow
                key={s.id}
                href={initiativePath(teamKey, s.id)}
                name={s.name}
                statusColor={INITIATIVE_STATUS_META[s.status].color}
                statusLabel={INITIATIVE_STATUS_META[s.status].label}
                health={s.health}
                removeLabel="Remove sub-initiative"
                onRemove={relationId ? () => remove.mutate(relationId) : undefined}
              />
            );
          })}
        </ul>
      )}
    </InitiativeSection>
  );
}
