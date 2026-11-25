import { cn } from '@/lib/utils';
import { SERVICE_LABEL, type ImportSource } from '../utils/imports';

const SOURCES: ImportSource[] = ['github', 'gitlab', 'gitea', 'forgejo', 'csv'];

// The source an import reads from, as a row of toggle buttons.
export default function ImportSourcePicker({
  value,
  onChange,
}: {
  value: ImportSource;
  onChange: (service: ImportSource) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Source" className="flex flex-wrap gap-1.5">
      {SOURCES.map((s) => (
        <button
          key={s}
          type="button"
          role="radio"
          aria-checked={value === s}
          onClick={() => onChange(s)}
          className={cn(
            'rounded-md px-3 py-1.5 text-sm transition-colors',
            value === s
              ? 'bg-secondary font-medium text-foreground'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground',
          )}
        >
          {SERVICE_LABEL[s]}
        </button>
      ))}
    </div>
  );
}
