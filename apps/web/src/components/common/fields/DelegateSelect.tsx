import { Bot } from 'lucide-react';
import type { Assignee } from '@/types/team';
import Avatar from '@/components/common/Avatar';
import AppBadge from '@/components/common/AppBadge';
import { Pill } from './Pill';
import PopoverPick, { type PickItem } from './PopoverPick';

// The agent an issue is delegated to (Linear's delegate): an app user whose install
// granted app:assignable. The assignee stays the person responsible for the issue.
export default function DelegateSelect({
  delegates,
  value,
  onChange,
  readOnly,
}: {
  delegates: Assignee[];
  value: string | null;
  onChange: (userId: string | null) => void;
  readOnly?: boolean;
}) {
  const delegate = delegates.find((a) => a.userId === value);

  const toItem = (a: Assignee): PickItem => ({
    key: a.userId,
    search: a.name,
    icon: <Avatar name={a.name} image={a.image} className="size-4 text-[8px]" />,
    label: a.name,
    selected: a.userId === value,
    onSelect: () => onChange(a.userId),
  });

  return (
    <PopoverPick
      readOnly={readOnly}
      trigger={
        <Pill active={!!value}>
          {delegate ? (
            <Avatar name={delegate.name} image={delegate.image} className="size-4 text-[8px]" />
          ) : (
            <Bot />
          )}
          {delegate?.name ?? (value ? 'An agent' : 'No delegate')}
          {delegate && <AppBadge />}
        </Pill>
      }
      inputPlaceholder="Delegate to…"
      emptyText="No agents."
      items={[
        {
          key: 'none',
          search: 'No delegate',
          icon: <Bot />,
          label: 'No delegate',
          selected: value == null,
          onSelect: () => onChange(null),
        },
      ]}
      groups={[{ heading: 'Agents', items: delegates.map(toItem) }]}
    />
  );
}
