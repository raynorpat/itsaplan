import { CalendarClock, Hexagon, RefreshCcw } from 'lucide-react';
import type { ListField } from '@/utils/list';
import { formatShortDate } from '@/utils/dates';
import {
  AssigneeAvatar,
  DateBadge,
  DelegateAvatar,
  LabelBadge,
} from '@/components/common/issue/IssueBadges';
import { RequestsBadge } from '@/components/common/issue/RequestsBadge';
import { EstimateBadge } from '@/components/common/issue/EstimateBadge';
import type { ListRowData } from './ListRowContent';

// One right-hand field of a list row. Empty fields render nothing except the
// avatar slots, which keep their width so avatars line up down the list.
export function ListRowField({ field, data }: { field: ListField; data: ListRowData }) {
  switch (field) {
    case 'requests':
      return <RequestsBadge issue={data.requests} />;
    case 'labels':
      return data.labels.length > 0 ? (
        <span className="hidden max-w-[260px] shrink-0 items-center gap-1 overflow-hidden md:flex">
          {data.labels.map((l) => (
            <LabelBadge key={l.id} color={l.color} name={l.name} />
          ))}
        </span>
      ) : null;
    case 'project':
      return data.project ? (
        <span className="hidden max-w-[160px] shrink-0 items-center gap-1 text-xs text-muted-foreground md:flex">
          <Hexagon className="size-3 shrink-0" />
          <span className="truncate">{data.project}</span>
        </span>
      ) : null;
    case 'cycle':
      return data.cycle ? (
        <span className="hidden max-w-[120px] shrink-0 items-center gap-1 text-xs text-muted-foreground md:flex">
          <RefreshCcw className="size-3 shrink-0" />
          <span className="truncate">{data.cycle}</span>
        </span>
      ) : null;
    case 'estimate':
      return data.estimateChip !== undefined ? (
        data.estimateChip
      ) : (
        <EstimateBadge estimate={data.estimate} label={data.estimateLabel} />
      );
    case 'dueDate':
      return data.dueDate ? (
        <span className="shrink-0">
          <DateBadge
            icon={<CalendarClock className="size-2.5" />}
            date={data.dueDate.date}
            overdue={data.dueDate.overdue}
          />
        </span>
      ) : null;
    case 'delegate':
      return (
        <span className="flex w-5 shrink-0 justify-center">
          {data.delegate && (
            <DelegateAvatar name={data.delegate.name} image={data.delegate.image} />
          )}
        </span>
      );
    case 'assignee':
      return (
        <span className="flex w-5 shrink-0 justify-center">
          {data.assignee && (
            <AssigneeAvatar name={data.assignee.name} image={data.assignee.image} />
          )}
        </span>
      );
    case 'created':
      return (
        <span className="w-12 shrink-0 text-right text-xs text-muted-foreground">
          {formatShortDate(data.createdAt)}
        </span>
      );
    case 'updated':
      return (
        <span className="w-12 shrink-0 text-right text-xs text-muted-foreground">
          {formatShortDate(data.updatedAt)}
        </span>
      );
  }
}
