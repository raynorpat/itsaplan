import { type ReactNode } from 'react';
import { CircleDashed, Triangle } from 'lucide-react';
import { estimateLabel, estimateOptions, type TeamEstimateSettings } from '@/utils/estimates';
import { Pill } from './Pill';
import PopoverPick from './PopoverPick';

// The issue's estimate, picked from the team's scale (Linear's estimate picker), with
// "No estimate" to clear it. `trigger` replaces the default pill (the row and card chip
// opens the same list).
export default function EstimateSelect({
  settings,
  value,
  onChange,
  readOnly,
  trigger,
}: {
  settings: TeamEstimateSettings;
  value: number | null;
  onChange: (v: number | null) => void;
  readOnly?: boolean;
  trigger?: ReactNode;
}) {
  const options = estimateOptions(settings);
  return (
    <PopoverPick
      readOnly={readOnly}
      trigger={
        trigger ?? (
          <Pill active={value != null}>
            <Triangle />
            {value != null ? estimateLabel(settings, value) : 'Estimate'}
          </Pill>
        )
      }
      inputPlaceholder="Set estimate to…"
      items={[
        {
          key: 'none',
          search: 'No estimate',
          icon: <CircleDashed />,
          label: 'No estimate',
          selected: value == null,
          onSelect: () => onChange(null),
        },
        ...options.map((o) => ({
          key: String(o.value),
          search: `${o.label} ${o.value}`,
          icon: <Triangle />,
          label: o.label,
          selected: o.value === value,
          onSelect: () => onChange(o.value),
        })),
      ]}
    />
  );
}
