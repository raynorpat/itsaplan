import { Archive, Clock, MailOpen, Mail, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { snoozePreset } from '../utils/snooze';

// Shown in place of the toolbar while rows are checked: bulk read / unread, snooze
// and archive for the checked notifications, and a way to clear the selection.
export default function InboxSelectionBar({
  count,
  onRead,
  onSnooze,
  onArchive,
  onClear,
}: {
  count: number;
  onRead: (read: boolean) => void;
  onSnooze: (until: string) => void;
  onArchive: () => void;
  onClear: () => void;
}) {
  return (
    <div className="flex items-center justify-between border-b px-4 py-3">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          title="Clear selection"
          onClick={onClear}
        >
          <X />
        </Button>
        <span className="text-sm font-semibold">{count} selected</span>
      </div>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          title="Mark as read"
          onClick={() => onRead(true)}
        >
          <MailOpen />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          title="Mark as unread"
          onClick={() => onRead(false)}
        >
          <Mail />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-7" title="Snooze">
              <Clock />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => onSnooze(snoozePreset('tomorrow'))}>
              Tomorrow
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onSnooze(snoozePreset('week'))}>
              In a week
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button variant="ghost" size="icon" className="size-7" title="Archive" onClick={onArchive}>
          <Archive />
        </Button>
      </div>
    </div>
  );
}
