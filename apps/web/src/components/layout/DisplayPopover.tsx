import { useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import type { ViewSettings } from '@/utils/viewSettings';
import type { WorkItemsView } from '@/utils/viewTypes';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import DisplaySettingsBody from '@/components/layout/DisplaySettingsBody';

// The display settings (layout switcher plus the selected layout's options) in a
// popover anchored to the sliders button.
export default function DisplayPopover({
  view,
  onViewChange,
  settings,
  onSettingsChange,
  cyclesOn,
  requestsOn,
  estimatesOn,
}: {
  view: WorkItemsView;
  onViewChange: (view: WorkItemsView) => void;
  settings: ViewSettings;
  onSettingsChange: (settings: ViewSettings) => void;
  // Whether the team's cycles are on; the cycle grouping and property show only then.
  cyclesOn: boolean;
  // Whether the list has feedback counts (not for guests); Requests shows only then.
  requestsOn: boolean;
  // Whether the team estimates; the Estimate property and ordering show only then.
  estimatesOn: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="Display"
          className={cn(
            'rounded-md p-1.5 hover:bg-accent hover:text-foreground',
            open ? 'bg-accent text-foreground' : 'text-muted-foreground',
          )}
        >
          <SlidersHorizontal className="size-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="max-h-[70vh] w-[22rem] overflow-y-auto p-3">
        <DisplaySettingsBody
          view={view}
          onViewChange={onViewChange}
          settings={settings}
          onSettingsChange={onSettingsChange}
          cyclesOn={cyclesOn}
          requestsOn={requestsOn}
          estimatesOn={estimatesOn}
        />
      </PopoverContent>
    </Popover>
  );
}
