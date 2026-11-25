'use client';

import { Button } from '@/components/ui/button';
import { CADENCES, cadenceLabel, type SummaryCadence } from '../utils/updates';

// Weekly / Daily / Off for the summary email, as a row of buttons.
export default function PortalCadencePicker({
  value,
  disabled,
  onChange,
}: {
  value: SummaryCadence;
  disabled?: boolean;
  onChange: (cadence: SummaryCadence) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Summary email" className="flex gap-1">
      {CADENCES.map((cadence) => (
        <Button
          key={cadence}
          type="button"
          size="sm"
          role="radio"
          aria-checked={value === cadence}
          variant={value === cadence ? 'secondary' : 'ghost'}
          disabled={disabled}
          onClick={() => onChange(cadence)}
        >
          {cadenceLabel(cadence)}
        </Button>
      ))}
    </div>
  );
}
