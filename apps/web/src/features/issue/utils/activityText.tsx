import { type ReactNode } from 'react';
import { formatDate } from '@/utils/dates';

import {
  Archive,
  ArchiveRestore,
  Calendar,
  CircleDot,
  CirclePlus,
  FileText,
  FolderKanban,
  Link2,
  RefreshCcw,
  Pencil,
  SignalHigh,
  Bot,
  Tag,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import { type ActivityAction, type FeedItem } from '@/lib/api';
import { priorityLabel } from '@/utils/fieldOptions';
import { RELATION_PHRASE } from '@/utils/issueRelations';

// Renders one activity feed event as an icon plus a verb phrase. Kept out of the
// feed component so the switch over action types stays isolated from the layout.

export const ACTION_ICON: Record<ActivityAction, LucideIcon> = {
  created: CirclePlus,
  title: Pencil,
  description: FileText,
  status: CircleDot,
  assignee: UserRound,
  delegate: Bot,
  priority: SignalHigh,
  due_date: Calendar,
  label_add: Tag,
  label_remove: Tag,
  archived: Archive,
  relation: Link2,
  restored: ArchiveRestore,
  project: FolderKanban,
  cycle: RefreshCcw,
};

const fmtDate = (v: string | null) => (v ? formatDate(v) : '');

// Long values (a description) are shown behind a
// popover rather than inline, so the feed row stays compact.
const isLong = (text: string | null): text is string =>
  !!text && (text.length > 80 || text.includes('\n'));

// The verb phrase for one event (everything after the actor's name). Returns a
// popover node too when the change carries a long value worth expanding.
export function describeActivity(a: FeedItem): { line: ReactNode; popover?: string } {
  // Values are slightly brighter than the connective words but still muted —
  // the whole activity row reads as secondary to comments.
  const strong = (t: string | null) => <span className="text-foreground/70">{t}</span>;
  switch (a.action) {
    case 'created':
      return { line: 'created the issue' };
    case 'title':
      return isLong(a.toText)
        ? { line: 'changed the title', popover: a.toText }
        : { line: <>renamed to {strong(`“${a.toText}”`)}</> };
    case 'description':
      // Linear's history records that the description changed, not the text.
      return a.toText
        ? { line: 'updated the description', popover: a.toText }
        : { line: 'updated the description' };
    case 'status':
      // A change logged before ids were recorded may carry no names.
      if (!a.fromText && !a.toText) return { line: 'changed the status' };
      return a.fromText
        ? {
            line: (
              <>
                moved from {strong(a.fromText)} to {strong(a.toText)}
              </>
            ),
          }
        : { line: <>set status to {strong(a.toText)}</> };
    case 'assignee':
      if (!a.fromText && !a.toText) return { line: 'changed the assignee' };
      if (!a.toText) return { line: <>removed assignee {strong(a.fromText)}</> };
      return {
        line: a.fromText ? (
          <>re-assigned to {strong(a.toText)}</>
        ) : (
          <>assigned to {strong(a.toText)}</>
        ),
      };
    case 'delegate':
      if (!a.toText) return { line: <>removed delegate {strong(a.fromText)}</> };
      return {
        line: a.fromText ? (
          <>re-delegated to {strong(a.toText)}</>
        ) : (
          <>delegated to {strong(a.toText)}</>
        ),
      };
    case 'priority':
      return Number(a.toText)
        ? { line: <>set priority to {strong(priorityLabel(Number(a.toText)))}</> }
        : { line: 'removed priority' };
    case 'due_date':
      return a.toText
        ? { line: <>set due date to {strong(fmtDate(a.toText))}</> }
        : { line: 'removed due date' };
    case 'label_add':
      return { line: <>added label {strong(a.toText)}</> };
    case 'label_remove':
      return { line: <>removed label {strong(a.fromText)}</> };
    case 'project':
      if (!a.toText)
        return a.fromText
          ? { line: <>removed from {strong(a.fromText)}</> }
          : { line: 'changed the project' };
      return { line: <>moved to {strong(a.toText)}</> };
    case 'cycle':
      if (!a.toText)
        return a.fromText
          ? { line: <>removed from {strong(a.fromText)}</> }
          : { line: 'changed the cycle' };
      return { line: <>added to {strong(a.toText)}</> };
    case 'archived':
      return { line: 'archived the issue' };
    case 'restored':
      return { line: 'restored the issue' };
    case 'relation': {
      // subject is the relation as seen from this issue; toText names the other
      // issue when the relation was added, fromText when it was removed.
      const phrase = RELATION_PHRASE[a.subject ?? ''] ?? 'related to';
      return a.toText
        ? {
            line: (
              <>
                marked as {phrase} {strong(a.toText)}
              </>
            ),
          }
        : {
            line: (
              <>
                removed {phrase} {strong(a.fromText)}
              </>
            ),
          };
    }
    default:
      return { line: a.action };
  }
}
