import { type ElementType } from 'react';
import { Archive, CalendarClock, Clock, MailOpen } from 'lucide-react';
import { snoozePreset } from '../utils/snooze';

// The menu primitives to render with. DropdownMenu and ContextMenu expose the same
// component API, so the same item list backs both the "…" button and the row's
// right-click menu.
interface MenuComponents {
  Item: ElementType;
  Separator: ElementType;
  Sub: ElementType;
  SubTrigger: ElementType;
  SubContent: ElementType;
}

// The shared inbox-row actions: read/unread, a Snooze submenu (presets + pick a
// date, or unsnooze when already snoozed), and archive.
export default function InboxItemActions({
  menu,
  unread,
  snoozed,
  onToggleRead,
  onSnooze,
  onPickDate,
  onArchive,
}: {
  menu: MenuComponents;
  unread: boolean;
  snoozed: boolean;
  onToggleRead: (read: boolean) => void;
  onSnooze: (until: string | null) => void;
  onPickDate: () => void;
  onArchive: () => void;
}) {
  const { Item, Separator, Sub, SubTrigger, SubContent } = menu;
  return (
    <>
      <Item onSelect={() => onToggleRead(unread)}>
        <MailOpen />
        {unread ? 'Mark as read' : 'Mark as unread'}
      </Item>
      <Separator />
      {snoozed ? (
        <Item onSelect={() => onSnooze(null)}>
          <Clock />
          Unsnooze
        </Item>
      ) : (
        <Sub>
          <SubTrigger>
            <Clock />
            Snooze
          </SubTrigger>
          <SubContent>
            <Item onSelect={() => onSnooze(snoozePreset('tomorrow'))}>Tomorrow</Item>
            <Item onSelect={() => onSnooze(snoozePreset('week'))}>In a week</Item>
            <Separator />
            <Item onSelect={onPickDate}>
              <CalendarClock />
              Pick a date…
            </Item>
          </SubContent>
        </Sub>
      )}
      <Separator />
      <Item onSelect={onArchive}>
        <Archive />
        Archive
      </Item>
    </>
  );
}
