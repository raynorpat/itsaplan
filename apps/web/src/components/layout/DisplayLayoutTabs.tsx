import { useHotkeyFormatter } from '@/context/useHotkeys';
import { cn } from '@/lib/utils';
import { VIEWS, type WorkItemsView } from '@/utils/viewTypes';

// Linear's two layouts are the main choice; Timeline and Calendar are kept as
// extra layouts below them.
const MAIN: WorkItemsView[] = ['list', 'kanban'];

// The layout switcher at the top of the Display menu, as in Linear: List and Board
// as two large toggles, then the extra layouts as small buttons. The hotkey is
// appended to the tooltip when the layout has one bound.
export default function DisplayLayoutTabs({
  view,
  onViewChange,
}: {
  view: WorkItemsView;
  onViewChange: (view: WorkItemsView) => void;
}) {
  const hotkey = useHotkeyFormatter();
  const title = (label: string, id: (typeof VIEWS)[number]['hotkey']) =>
    hotkey(id) ? `${label} (${hotkey(id)})` : label;
  const main = VIEWS.filter((v) => MAIN.includes(v.value));
  const extra = VIEWS.filter((v) => !MAIN.includes(v.value));

  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-2 gap-1.5">
        {main.map(({ value, label, icon: Icon, hotkey: id }) => (
          <button
            key={value}
            type="button"
            aria-pressed={value === view}
            title={title(label, id)}
            onClick={() => onViewChange(value)}
            className={cn(
              'flex flex-col items-center gap-1 rounded-md border py-2 text-xs transition-colors',
              value === view
                ? 'border-transparent bg-secondary text-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            <Icon className="size-4" />
            {label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1 px-1">
        <span className="mr-auto text-xs text-muted-foreground">Other layouts</span>
        {extra.map(({ value, label, icon: Icon, hotkey: id }) => (
          <button
            key={value}
            type="button"
            aria-pressed={value === view}
            title={title(label, id)}
            onClick={() => onViewChange(value)}
            className={cn(
              'flex items-center gap-1 rounded-md px-1.5 py-1 text-xs transition-colors',
              value === view
                ? 'bg-secondary text-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            <Icon className="size-3.5" />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
