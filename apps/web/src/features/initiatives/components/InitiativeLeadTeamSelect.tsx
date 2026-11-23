'use client';

import { Users } from 'lucide-react';
import { useTeamsQuery } from '@/services/teams.service';
import { Pill } from '@/components/common/fields/Pill';
import PopoverPick from '@/components/common/fields/PopoverPick';

// The lead team, which decides who sees the initiative: without one it is visible to
// the whole workspace (except guests).
export default function InitiativeLeadTeamSelect({
  value,
  onChange,
}: {
  value: { id: string; name: string } | null;
  onChange: (teamId: string | null) => void;
}) {
  const teams = useTeamsQuery().data ?? [];
  const icon = <Users className="size-3.5" />;
  return (
    <PopoverPick
      trigger={
        <Pill active={value != null}>
          {icon}
          {value?.name ?? 'No lead team'}
        </Pill>
      }
      inputPlaceholder="Set lead team…"
      items={[
        {
          key: 'none',
          search: 'No lead team',
          icon,
          label: 'No lead team',
          selected: value == null,
          onSelect: () => onChange(null),
        },
        ...teams.map((t) => ({
          key: t.id,
          search: t.name,
          icon,
          label: t.name,
          selected: t.id === value?.id,
          onSelect: () => onChange(t.id),
        })),
      ]}
    />
  );
}
