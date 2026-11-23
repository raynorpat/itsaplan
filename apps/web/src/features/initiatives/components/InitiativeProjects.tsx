'use client';

import { linkIdOf } from '../utils/initiativeLinks';
import { type InitiativeDetail } from '../services/initiatives.service';
import { useUnlinkProject } from '../services/initiativeLinks.service';
import InitiativeAddProject from './InitiativeAddProject';
import InitiativeLinkedRow from './InitiativeLinkedRow';
import InitiativeSection from './InitiativeSection';
import { projectPath } from '@/utils/paths';
import { STATUS_META } from '@/utils/projectMeta';

// The projects linked directly to the initiative, each removable, and a picker to
// link another. Projects of sub-initiatives are on the sub-initiatives' pages.
export default function InitiativeProjects({
  initiative,
  teamKey,
}: {
  initiative: InitiativeDetail;
  teamKey: string;
}) {
  const unlink = useUnlinkProject();
  return (
    <InitiativeSection
      title="Projects"
      action={
        <InitiativeAddProject
          initiativeId={initiative.id}
          linked={new Set(initiative.projects.map((p) => p.id))}
        />
      }
    >
      {initiative.projects.length === 0 ? (
        <p className="text-sm text-muted-foreground">No projects linked.</p>
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border">
          {initiative.projects.map((p) => {
            const linkId = linkIdOf(p, initiative.id);
            return (
              <InitiativeLinkedRow
                key={p.id}
                href={projectPath(teamKey, p.id)}
                name={p.name}
                statusColor={STATUS_META[p.status].color}
                statusLabel={STATUS_META[p.status].label}
                health={p.health}
                removeLabel="Remove project"
                onRemove={linkId ? () => unlink.mutate(linkId) : undefined}
              />
            );
          })}
        </ul>
      )}
    </InitiativeSection>
  );
}
