import { Label } from '@/components/ui/label';

const TYPES = [
  {
    value: 'continuous',
    label: 'Continuous',
    hint: 'Every deploy is a release, named after its commit.',
  },
  {
    value: 'scheduled',
    label: 'Scheduled',
    hint: 'A release collects issues until you complete it.',
  },
] as const;

// The pipeline's type, as two radio choices with what each means.
export default function PipelineTypeField({
  value,
  onChange,
}: {
  value: 'continuous' | 'scheduled';
  onChange: (value: 'continuous' | 'scheduled') => void;
}) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-sm font-medium">Type</legend>
      {TYPES.map((t) => (
        <Label
          key={t.value}
          className="flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 font-normal has-[:checked]:border-primary"
        >
          <input
            type="radio"
            name="pipeline-type"
            value={t.value}
            checked={value === t.value}
            onChange={() => onChange(t.value)}
            className="mt-0.5"
          />
          <span className="flex flex-col gap-0.5">
            <span className="text-sm">{t.label}</span>
            <span className="text-xs text-muted-foreground">{t.hint}</span>
          </span>
        </Label>
      ))}
    </fieldset>
  );
}
