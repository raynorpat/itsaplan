'use client';

import { useState } from 'react';
import { Plus, Target } from 'lucide-react';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { Pill } from '@/components/common/fields/Pill';
import PopoverPick from '@/components/common/fields/PopoverPick';
import { linkableProjects } from '../utils/initiativeLinks';
import { useLinkProject, useProjectPickerQuery } from '../services/initiativeLinks.service';

// "Add project": the visible projects not linked yet, searched by name on the server.
// The projects load when the picker is first opened.
export default function InitiativeAddProject({
  initiativeId,
  linked,
}: {
  initiativeId: string;
  linked: Set<string>;
}) {
  const [opened, setOpened] = useState(false);
  const [search, setSearch] = useState('');
  const query = useProjectPickerQuery(useDebouncedValue(search.trim(), 250), opened);
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
        onSearchChange={setSearch}
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
