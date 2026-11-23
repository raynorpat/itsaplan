import { RefreshCcw } from 'lucide-react';
import type { Cycle } from '@/lib/api';
import { cycleLabel, cycleOptions } from '@/utils/cycles';
import { Pill } from './Pill';
import PopoverPick, { type PickItem } from './PopoverPick';

// The cycle of an issue: "No cycle", the team's current cycle and its upcoming ones.
// An issue still in a past cycle shows that cycle's name on the pill.
export default function CycleSelect({
  cycles,
  value,
  onChange,
  readOnly,
}: {
  cycles: Cycle[];
  value: string | null;
  onChange: (cycleId: string | null) => void;
  readOnly?: boolean;
}) {
  const { current, upcoming } = cycleOptions(cycles, new Date());
  const selected = value != null ? cycles.find((c) => c.id === value) : undefined;
  const icon = <RefreshCcw className="size-3.5" />;
  const item = (cycle: Cycle, suffix: string): PickItem => ({
    key: cycle.id,
    search: cycleLabel(cycle),
    icon,
    label: `${cycleLabel(cycle)}${suffix}`,
    selected: cycle.id === value,
    onSelect: () => onChange(cycle.id),
  });
  return (
    <PopoverPick
      readOnly={readOnly}
      trigger={
        <Pill active={!!selected}>
          {icon}
          {selected ? cycleLabel(selected) : 'Cycle'}
        </Pill>
      }
      inputPlaceholder="Move to cycle…"
      emptyText="No cycles"
      items={[
        {
          key: 'none',
          search: 'No cycle',
          icon,
          label: 'No cycle',
          selected: value == null,
          onSelect: () => onChange(null),
        },
        ...(current ? [item(current, ' · Current')] : []),
        ...upcoming.map((c, i) => item(c, i === 0 ? ' · Next' : '')),
      ]}
    />
  );
}
