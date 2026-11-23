import { Archive, CheckCheck, ListFilter, MoreHorizontal, SlidersHorizontal } from 'lucide-react';
import type { NotificationType } from '@/types/notification';
import { type InboxFilters } from '../utils/inbox';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const TYPE_LABELS: { value: NotificationType; label: string }[] = [
  { value: 'assigned', label: 'Assigned' },
  { value: 'mentioned', label: 'Mentioned' },
  { value: 'commented', label: 'Commented' },
  { value: 'state_changed', label: 'Status changed' },
  { value: 'agent_needs_input', label: 'Agent needs input' },
  { value: 'agent_response', label: 'Agent responded' },
];

// The inbox list header: title with unread count, a type filter, display toggles
// (show read / snoozed), and the actions on the whole inbox. Linear archives
// notifications rather than deleting them, so the clean-up actions archive.
export default function InboxToolbar({
  unread,
  filters,
  onFiltersChange,
  onMarkAllRead,
  onArchiveRead,
  onArchiveReadCompleted,
}: {
  unread: number;
  filters: InboxFilters;
  onFiltersChange: (next: InboxFilters) => void;
  onMarkAllRead: () => void;
  onArchiveRead: () => void;
  onArchiveReadCompleted: () => void;
}) {
  const selectedTypes = filters.types;

  const toggleType = (type: NotificationType) => {
    const next = selectedTypes.includes(type)
      ? selectedTypes.filter((t) => t !== type)
      : [...selectedTypes, type];
    onFiltersChange({ ...filters, types: next });
  };

  return (
    <div className="flex items-center justify-between border-b px-4 py-3">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold">Inbox</span>
        {unread > 0 && <span className="text-xs text-muted-foreground">{unread}</span>}
      </div>
      <div className="flex items-center gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-7" title="Filter">
              <ListFilter />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Notification type</DropdownMenuLabel>
            {TYPE_LABELS.map((t) => (
              <DropdownMenuCheckboxItem
                key={t.value}
                checked={selectedTypes.includes(t.value)}
                onCheckedChange={() => toggleType(t.value)}
                onSelect={(e) => e.preventDefault()}
              >
                {t.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-7" title="Display">
              <SlidersHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuCheckboxItem
              checked={filters.showRead}
              onCheckedChange={(v) => onFiltersChange({ ...filters, showRead: v === true })}
              onSelect={(e) => e.preventDefault()}
            >
              Show read
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={filters.showSnoozed}
              onCheckedChange={(v) => onFiltersChange({ ...filters, showSnoozed: v === true })}
              onSelect={(e) => e.preventDefault()}
            >
              Show snoozed
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-7" title="More">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onMarkAllRead}>
              <CheckCheck />
              Mark all as read
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onArchiveRead}>
              <Archive />
              Archive all read
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onArchiveReadCompleted}>
              <Archive />
              Archive read for completed issues
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
