'use client';

import type { ProjectHealth } from '@/types/project';
import { HEALTH_META } from '@/utils/projectMeta';
import { colorDot } from '@/components/common/fields/colorDot';
import { Pill } from '@/components/common/fields/Pill';
import PopoverPick from '@/components/common/fields/PopoverPick';

const HEALTHS: ProjectHealth[] = ['onTrack', 'atRisk', 'offTrack'];

// The health a project or initiative update reports: on track, at risk or off
// track.
export default function HealthSelect({
  value,
  onChange,
}: {
  value: ProjectHealth;
  onChange: (health: ProjectHealth) => void;
}) {
  const meta = HEALTH_META[value];
  return (
    <PopoverPick
      trigger={
        <Pill active>
          {colorDot(meta.color)}
          {meta.label}
        </Pill>
      }
      inputPlaceholder="Set health…"
      items={HEALTHS.map((h) => ({
        key: h,
        search: HEALTH_META[h].label,
        icon: colorDot(HEALTH_META[h].color),
        label: HEALTH_META[h].label,
        selected: h === value,
        onSelect: () => onChange(h),
      }))}
    />
  );
}
