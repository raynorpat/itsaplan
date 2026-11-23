'use client';

import { useState } from 'react';
import { Plus, Target } from 'lucide-react';
import { Pill } from '@/components/common/fields/Pill';
import PopoverPick from '@/components/common/fields/PopoverPick';
import { linkableProjects } from '../utils/initiativeLinks';
import { useLinkProject, useProjectPickerQuery } from '../services/initiativeLinks.service';

// "Add project": a searchable list of the visible projects not linked yet. The
// projects load when the picker is first opened.
export default function InitiativeAddProject({
  initiativeId,
  linked,
}: {
  initiativeId: string;
  linked: Set<string>;
}) {
  const [opened, setOpened] = useState(false);
  const query = useProjectPickerQuery(opened);
  const projects = query.data ?? [];
  const link = useLinkProject(initiativeId);
  return (
    <span onPointerDown={() => setOpened(true)} onFocus={() => setOpened(true)}>
      <PopoverPick
        trigger={
          <Pill>
            <Plus className="size-3.5" />
            Add project
          </Pill>
        }
        inputPlaceholder="Link a project…"
        emptyText={query.isLoading ? 'Loading…' : 'No projects to link.'}
        items={linkableProjects(projects, linked).map((p) => ({
          key: p.id,
          search: p.name,
          icon: <Target className="size-3.5" />,
          label: p.name,
          selected: false,
          onSelect: () => link.mutate(p.id),
        }))}
      />
    </span>
  );
}
