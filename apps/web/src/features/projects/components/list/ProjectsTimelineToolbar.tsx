import { CalendarClock } from 'lucide-react';
import type { TimelineScale } from '@/utils/viewSettings';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PROJECT_GROUPINGS, type ProjectGrouping } from '../../utils/projectTimeline';

const ZOOMS: { value: TimelineScale; label: string }[] = [
  { value: 'week', label: 'Weeks' },
  { value: 'month', label: 'Months' },
  { value: 'quarter', label: 'Quarters' },
];

// The timeline's grouping, zoom and a button that scrolls to today.
export default function ProjectsTimelineToolbar({
  grouping,
  zoom,
  onGrouping,
  onZoom,
  onToday,
}: {
  grouping: ProjectGrouping;
  zoom: TimelineScale;
  onGrouping: (grouping: ProjectGrouping) => void;
  onZoom: (zoom: TimelineScale) => void;
  onToday: () => void;
}) {
  return (
    <div className="flex items-center gap-2 px-4 pb-2">
      <Select value={grouping} onValueChange={(v) => onGrouping(v as ProjectGrouping)}>
        <SelectTrigger size="sm" className="h-8 w-40" aria-label="Group by">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PROJECT_GROUPINGS.map((g) => (
            <SelectItem key={g.value} value={g.value}>
              {g.value === 'none' ? g.label : `Group by ${g.label.toLowerCase()}`}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={zoom} onValueChange={(v) => onZoom(v as TimelineScale)}>
        <SelectTrigger size="sm" className="h-8 w-32" aria-label="Zoom">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ZOOMS.map((z) => (
            <SelectItem key={z.value} value={z.value}>
              {z.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={onToday}>
        <CalendarClock className="size-3.5" />
        Today
      </Button>
    </div>
  );
}
