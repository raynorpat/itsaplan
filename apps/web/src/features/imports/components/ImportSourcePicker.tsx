import { cn } from '@/lib/utils';
import { SERVICE_LABEL, type ImportService } from '../utils/imports';

const SOURCES: ImportService[] = ['github', 'gitlab', 'gitea', 'forgejo'];

// The source an import reads from, as a row of toggle buttons.
export default function ImportSourcePicker({
  value,
  onChange,
}: {
  value: ImportService;
  onChange: (service: ImportService) => void;
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
