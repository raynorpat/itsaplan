'use client';

import { CircleDashed } from 'lucide-react';
import Avatar from '@/components/common/Avatar';
import { Pill } from '@/components/common/fields/Pill';
import PopoverPick, { type PickItem } from '@/components/common/fields/PopoverPick';
import { useWorkspaceUsersQuery } from '@/services/members.service';

// Picks the customer's owner among the workspace's active members (Linear: application
// accounts and guests do not own customers), or clears it.
export default function CustomerOwnerPick({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (userId: string | null) => void;
}) {
  const users = (useWorkspaceUsersQuery().data ?? []).filter(
    (u) => !u.suspended && u.role !== 'guest',
  );
  const owner = users.find((u) => u.userId === value) ?? null;
  const items: PickItem[] = [
    {
      key: '__none',
      search: 'No owner',
      icon: <CircleDashed className="size-4" />,
      label: 'No owner',
      selected: value === null,
      onSelect: () => onChange(null),
    },
    ...users.map((u) => ({
      key: u.userId,
      search: `${u.name} ${u.email}`,
      icon: <Avatar name={u.name} image={u.image} className="size-4 text-[8px]" />,
      label: u.name,
      selected: u.userId === value,
      onSelect: () => onChange(u.userId),
    })),
  ];
  return (
    <PopoverPick
      inputPlaceholder="Set owner…"
      emptyText="No one found."
      items={items}
      trigger={
        <Pill active={owner !== null} aria-label="Owner">
          {owner ? (
            <Avatar name={owner.name} image={owner.image} className="size-4 text-[8px]" />
          ) : (
            <CircleDashed />
          )}
          {owner?.name ?? 'No owner'}
        </Pill>
      }
    />
  );
}
