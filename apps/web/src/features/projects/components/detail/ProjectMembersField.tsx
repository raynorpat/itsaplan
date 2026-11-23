'use client';

import { UsersRound } from 'lucide-react';
import type { Assignee } from '@/lib/api';
import type { ProjectDetail } from '@/services/projects.service';
import Avatar from '@/components/common/Avatar';
import { Pill } from '@/components/common/fields/Pill';
import PopoverPick, { type PickItem } from '@/components/common/fields/PopoverPick';

// Linear's project members as a pill: the first members' avatars and a count. The
// picker offers the team's people (who can see the project) and the current
// members; a pick adds or removes one and saves the whole list.
export default function ProjectMembersField({
  project,
  assignees,
  onChange,
  readOnly,
}: {
  project: ProjectDetail;
  assignees: Assignee[];
  onChange: (memberIds: string[]) => void;
  readOnly?: boolean;
}) {
  const ids = project.members.map((m) => m.id);
  const people = new Map(project.members.map((m) => [m.id, { name: m.name, image: m.image }]));
  for (const a of assignees) people.set(a.userId, { name: a.name, image: a.image });

  const items: PickItem[] = [...people].map(([id, p]) => ({
    key: id,
    search: p.name,
    icon: <Avatar name={p.name} image={p.image} className="size-4 text-[8px]" />,
    label: p.name,
    selected: ids.includes(id),
    onSelect: () => onChange(ids.includes(id) ? ids.filter((m) => m !== id) : [...ids, id]),
  }));

  return (
    <PopoverPick
      readOnly={readOnly}
      closeOnSelect={false}
      trigger={
        <Pill active={ids.length > 0}>
          {project.members.length === 0 ? (
            <UsersRound />
          ) : (
            <span className="flex -space-x-1">
              {project.members.slice(0, 3).map((m) => (
                <Avatar key={m.id} name={m.name} image={m.image} className="size-4 text-[8px]" />
              ))}
            </span>
          )}
          {project.members.length === 0
            ? 'Members'
            : `${project.members.length} member${project.members.length === 1 ? '' : 's'}`}
        </Pill>
      }
      inputPlaceholder="Add members…"
      emptyText="No people."
      items={items}
    />
  );
}
