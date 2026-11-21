import { Pill } from './Pill';
import { PRIORITY_FIELDS } from './priorityFields';
import PopoverPick from './PopoverPick';

// Value is Linear's 0..4, 0 for none (matches PRIORITY_FIELDS[0]).
export default function PrioritySelect({
  value,
  onChange,
  readOnly,
}: {
  value: number;
  onChange: (v: number) => void;
  readOnly?: boolean;
}) {
  const prio = PRIORITY_FIELDS.find((p) => p.value === value) ?? PRIORITY_FIELDS[0];
  return (
    <PopoverPick
      readOnly={readOnly}
      trigger={
        <Pill active={!!value}>
          {prio.icon}
          {value ? prio.label : 'Priority'}
        </Pill>
      }
      inputPlaceholder="Set priority to…"
      items={PRIORITY_FIELDS.map((p) => ({
        key: String(p.value),
        search: p.label,
        icon: p.icon,
        label: p.label,
        selected: p.value === value,
        onSelect: () => onChange(p.value),
      }))}
    />
  );
}
