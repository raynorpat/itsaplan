import type { ReactNode } from 'react';
import type { Issue } from '@/types/issue';
import type { StateType } from '@/types/team';
import type { ListField, ListRowProperties } from '@/utils/list';
import { cn } from '@/lib/utils';
import { PriorityIcon, StateIcon } from '@/components/common/issue/IssueIcons';
import { ListRowField } from './ListRowField';

// What a list row shows, independent of where the issue came from (a team's
// board data or a cross-team query such as My issues).
export interface ListRowData {
  priority: number;
  identifier: string;
  title: string;
  state: { type: StateType; color: string; name: string } | null;
  labels: { id: string; name: string; color: string }[];
  project: string | null;
  cycle: string | null;
  estimate: number | null;
  // Shown in place of the plain estimate chip (a team row's picker chip).
  estimateChip?: ReactNode;
  dueDate: { date: string; overdue: boolean } | null;
  assignee: { name: string; image: string | null } | null;
  delegate: { name: string; image: string | null } | null;
  createdAt: string;
  updatedAt: string;
  requests: Pick<Issue, 'requests'>;
}

// One issue as a single dense line, as in Linear's list: priority, identifier,
// status and title on the left; the enabled fields on the right.
export function ListRowContent({
  data,
  properties,
  indented,
  selected,
}: {
  data: ListRowData;
  properties: ListRowProperties;
  indented?: boolean;
  selected?: boolean;
}) {
  const { leading, trailing } = properties;
  return (
    <div
      className={cn(
        'flex h-9 min-w-0 items-center gap-2.5 pr-4 text-sm',
        indented ? 'pl-10' : 'pl-4',
        selected && 'bg-primary/10',
      )}
    >
      {leading.priority && (
        <PriorityIcon priority={data.priority} className="shrink-0 text-muted-foreground" />
      )}
      {leading.id && (
        <span className="w-16 shrink-0 truncate text-xs text-muted-foreground tabular-nums">
          {data.identifier}
        </span>
      )}
      {leading.status && data.state && (
        <StateIcon stateType={data.state.type} color={data.state.color} className="shrink-0" />
      )}
      <span className="min-w-0 flex-1 truncate text-foreground">{data.title}</span>
      {trailing.map((field: ListField) => (
        <ListRowField key={field} field={field} data={data} />
      ))}
    </div>
  );
}
