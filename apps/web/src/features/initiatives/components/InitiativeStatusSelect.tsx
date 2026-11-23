'use client';

import { colorDot } from '@/components/common/fields/colorDot';
import { Pill } from '@/components/common/fields/Pill';
import PopoverPick from '@/components/common/fields/PopoverPick';
import {
  INITIATIVE_STATUS_META,
  OFFERED_STATUSES,
  type InitiativeStatus,
} from '../utils/initiativeMeta';

// The initiative's status as a pill opening Planned, Active and Completed.
export default function InitiativeStatusSelect({
  value,
  onChange,
}: {
  value: InitiativeStatus;
  onChange: (status: InitiativeStatus) => void;
}) {
  const meta = INITIATIVE_STATUS_META[value];
  return (
    <PopoverPick
      trigger={
        <Pill active>
          {colorDot(meta.color)}
          {meta.label}
        </Pill>
      }
      inputPlaceholder="Set status…"
      items={OFFERED_STATUSES.map((s) => ({
        key: s,
        search: INITIATIVE_STATUS_META[s].label,
        icon: colorDot(INITIATIVE_STATUS_META[s].color),
        label: INITIATIVE_STATUS_META[s].label,
        selected: s === value,
        onSelect: () => onChange(s),
      }))}
    />
  );
}
