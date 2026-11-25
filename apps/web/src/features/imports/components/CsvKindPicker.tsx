import { cn } from '@/lib/utils';
import type { CsvSourceKind } from '../services/csvImport.service';

const KINDS: { value: CsvSourceKind; label: string }[] = [
  { value: 'jira', label: 'Jira export' },
  { value: 'generic', label: 'Other CSV' },
];

// Whether the file is a Jira export (read by its fixed columns) or any other CSV (whose
// columns are mapped), as the source picker's toggle buttons.
export default function CsvKindPicker({
  value,
  onChange,
}: {
  value: CsvSourceKind;
  onChange: (kind: CsvSourceKind) => void;
}) {
  return (
    <div role="radiogroup" aria-label="CSV kind" className="flex flex-wrap gap-1.5">
      {KINDS.map((k) => (
        <button
          key={k.value}
          type="button"
          role="radio"
          aria-checked={value === k.value}
          onClick={() => onChange(k.value)}
          className={cn(
            'rounded-md px-3 py-1.5 text-sm transition-colors',
            value === k.value
              ? 'bg-secondary font-medium text-foreground'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground',
          )}
        >
          {k.label}
        </button>
      ))}
    </div>
  );
}
