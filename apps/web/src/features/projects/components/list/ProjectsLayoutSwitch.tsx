import { GanttChart, Rows3 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ProjectsLayout } from '../../utils/projectsDisplay';

const LAYOUTS: { value: ProjectsLayout; label: string; icon: typeof Rows3 }[] = [
  { value: 'table', label: 'Table', icon: Rows3 },
  { value: 'timeline', label: 'Timeline', icon: GanttChart },
];

// Table or timeline for the projects list.
export default function ProjectsLayoutSwitch({
  value,
  disabled,
  onChange,
}: {
  value: ProjectsLayout;
  disabled: boolean;
  onChange: (layout: ProjectsLayout) => void;
}) {
  return (
    <div role="group" aria-label="Layout" className="flex rounded-md border p-0.5">
      {LAYOUTS.map(({ value: layout, label, icon: Icon }) => (
        <button
          key={layout}
          type="button"
          aria-pressed={layout === value}
          disabled={disabled}
          onClick={() => onChange(layout)}
          className={cn(
            'flex h-7 items-center gap-1.5 rounded px-2 text-xs transition-colors disabled:opacity-50',
            layout === value
              ? 'bg-secondary text-foreground'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground',
          )}
        >
          <Icon className="size-3.5" />
          {label}
        </button>
      ))}
    </div>
  );
}
