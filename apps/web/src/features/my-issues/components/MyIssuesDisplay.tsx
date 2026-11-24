import { useState } from 'react';
import { ArrowDownNarrowWide, ArrowUpNarrowWide, SlidersHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SORT_FIELDS, type SortField } from '@/utils/viewTypes';
import type { ViewSettings } from '@/utils/viewSettings';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import DisplayIssueRows from '@/components/layout/DisplayIssueRows';
import DisplayPropertiesSection from '@/components/layout/DisplayPropertiesSection';
import DisplaySettingsRow from '@/components/layout/DisplaySettingsRow';
import DisplaySettingsSelect from '@/components/layout/DisplaySettingsSelect';
import { myIssuesGrouping, myIssuesSort, type MyIssuesGroup } from '../utils/myIssues';

const GROUP_OPTIONS: { value: MyIssuesGroup; label: string }[] = [
  { value: 'none', label: 'No grouping' },
  { value: 'status', label: 'State' },
  { value: 'priority', label: 'Priority' },
  { value: 'project', label: 'Project' },
];

// Its issues span teams, which share no manual order.
// It loads no feedback counts, so it offers no Requests ordering.
const ORDER_OPTIONS = SORT_FIELDS.filter((f) => f.value !== 'manual' && f.value !== 'requests');

// Linear's Display menu for My issues: grouping and ordering (the Activity tab lists
// by the newest change and ignores both), which issues show, and the row properties.
// My issues has only the List layout.
export default function MyIssuesDisplay({
  settings,
  onChange,
  activity,
}: {
  settings: ViewSettings;
  onChange: (settings: ViewSettings) => void;
  activity: boolean;
}) {
  const [open, setOpen] = useState(false);
  const set = (patch: Partial<ViewSettings>) => onChange({ ...settings, ...patch });
  const sort = myIssuesSort(settings.sort);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="Display"
          aria-label="Display"
          className={cn(
            'ml-auto rounded-md p-1.5 hover:bg-accent hover:text-foreground',
            open ? 'bg-accent text-foreground' : 'text-muted-foreground',
          )}
        >
          <SlidersHorizontal className="size-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="max-h-[70vh] w-[22rem] overflow-y-auto p-3">
        <div className="space-y-2">
          {!activity && (
            <>
              <DisplaySettingsRow label="Grouping">
                <DisplaySettingsSelect
                  value={myIssuesGrouping(settings.group)}
                  onChange={(v) => set({ group: v as MyIssuesGroup, subgroup: 'none' })}
                  options={GROUP_OPTIONS}
                />
              </DisplaySettingsRow>
              <DisplaySettingsRow label="Ordering">
                <Button
                  variant="outline"
                  size="icon"
                  className="size-8 shrink-0"
                  title={sort.dir === 'asc' ? 'Ascending' : 'Descending'}
                  onClick={() =>
                    set({ sort: { ...sort, dir: sort.dir === 'asc' ? 'desc' : 'asc' } })
                  }
                >
                  {sort.dir === 'asc' ? <ArrowUpNarrowWide /> : <ArrowDownNarrowWide />}
                </Button>
                <DisplaySettingsSelect
                  value={sort.field}
                  onChange={(v) => set({ sort: { ...sort, field: v as SortField } })}
                  options={ORDER_OPTIONS}
                />
              </DisplaySettingsRow>
            </>
          )}
          <DisplayIssueRows settings={settings} onChange={set} />
          <DisplayPropertiesSection
            settings={settings}
            onChange={set}
            cyclesOn
            requestsOn={false}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
