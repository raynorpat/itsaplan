import type { ReactNode } from 'react';
import { CalendarClock, CalendarPlus, History, RefreshCcw, Target } from 'lucide-react';
import { RequestsBadge } from '@/components/common/issue/RequestsBadge';
import { EstimateBadge } from '@/components/common/issue/EstimateBadge';
import { requesterCount } from '@/utils/requests';
import type { Issue } from '@/types/issue';
import { type Maps } from '@/utils/team';
import { cycleLabel } from '@/utils/cycles';
import { isDueOverdue } from '@/utils/dates';
import type { DisplayProperty, PropertyKey } from '@/utils/viewSettings';
import {
  AssigneeAvatar,
  DateBadge,
  DelegateAvatar,
  LabelBadge,
  PriorityBadge,
} from '@/components/common/issue/IssueBadges';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { StateIcon } from '@/components/common/issue/IssueIcons';
import { projectDisplayName } from '@/utils/projectMeta';

const CHIP = 'max-w-full rounded-full px-1.5 py-0.5 text-[10px] text-muted-foreground';

// One board card's content, laid out as Linear's compact card: the identifier with
// the assignee (and delegate) on the first line, the status icon and title, then one
// row of the enabled properties. Which properties render is driven by `properties`.
export function IssueCardBody({
  issue,
  maps,
  properties,
  estimateChip,
}: {
  issue: Issue;
  maps: Maps;
  properties: PropertyKey[];
  // The team's estimate chip (a picker for members); null hides the estimate (the team
  // does not estimate). Without it the plain chip shows.
  estimateChip?: ReactNode;
}) {
  const has = (p: DisplayProperty) => properties.includes(p);
  const assignee =
    issue.assigneeUserId != null ? maps.assigneeById.get(issue.assigneeUserId) : undefined;
  const delegate =
    issue.delegateUserId != null ? maps.assigneeById.get(issue.delegateUserId) : undefined;
  const project = issue.project ?? undefined;
  const cycle = issue.cycleId != null ? maps.cycleById.get(issue.cycleId) : undefined;
  const column = maps.columnById.get(issue.stateId);
  const showAssignee = has('assignee') && assignee;
  const showDelegate = has('delegate') && delegate;
  const propertiesShown =
    (has('priority') && issue.priority > 0) ||
    (has('estimate') && issue.estimate != null && estimateChip !== null) ||
    (has('dueDate') && issue.dueDate) ||
    (has('project') && project) ||
    (has('cycle') && cycle) ||
    (has('labels') && issue.labelIds.length > 0) ||
    (has('requests') && requesterCount(issue) > 0) ||
    has('created') ||
    has('updated');

  return (
    <>
      {(has('id') || showAssignee || showDelegate) && (
        <div className="mb-1 flex h-5 items-center justify-between gap-2">
          <span className="truncate text-xs text-muted-foreground">
            {has('id') ? issue.identifier : ''}
          </span>
          {/* Negative spacing so a delegate and an assignee shown together
              overlap; the ring in the card color keeps them separated. */}
          <div className="flex shrink-0 items-center -space-x-1.5">
            {showDelegate && (
              <DelegateAvatar
                name={delegate.name}
                image={delegate.image}
                className="ring-2 ring-[var(--kanban-card)]"
              />
            )}
            {showAssignee && (
              <AssigneeAvatar
                name={assignee.name}
                image={assignee.image}
                className="ring-2 ring-[var(--kanban-card)]"
              />
            )}
          </div>
        </div>
      )}

      <div className="flex items-start gap-1.5">
        {has('status') && column && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="mt-[3px] inline-flex shrink-0">
                <StateIcon stateType={column.stateType} color={column.color} className="size-3.5" />
              </span>
            </TooltipTrigger>
            <TooltipContent>{column.name}</TooltipContent>
          </Tooltip>
        )}
        <span className="line-clamp-2 text-sm leading-snug text-foreground">{issue.title}</span>
      </div>

      {propertiesShown && (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {has('priority') && issue.priority > 0 && <PriorityBadge priority={issue.priority} />}
          {has('estimate') &&
            (estimateChip !== undefined ? (
              estimateChip
            ) : (
              <EstimateBadge estimate={issue.estimate} />
            ))}
          {has('dueDate') && issue.dueDate && (
            <DateBadge
              icon={<CalendarClock className="size-2.5" />}
              date={issue.dueDate}
              title="Due date"
              overdue={isDueOverdue(issue.dueDate, column?.stateType)}
            />
          )}
          {has('project') && project && (
            <Badge variant="outline" className={CHIP}>
              <Target className="size-2.5 shrink-0" />
              <span className="truncate">{projectDisplayName(project)}</span>
            </Badge>
          )}
          {has('cycle') && cycle && (
            <Badge variant="outline" className={CHIP}>
              <RefreshCcw className="size-2.5 shrink-0" />
              <span className="truncate">{cycleLabel(cycle)}</span>
            </Badge>
          )}
          {has('requests') && <RequestsBadge issue={issue} />}
          {has('labels') &&
            issue.labelIds.map((id) => {
              const label = maps.labelById.get(id);
              if (!label) return null;
              return <LabelBadge key={id} color={label.color} name={label.name} />;
            })}
          {has('created') && (
            <DateBadge
              icon={<CalendarPlus className="size-2.5" />}
              date={issue.createdAt}
              title="Created"
            />
          )}
          {has('updated') && (
            <DateBadge
              icon={<History className="size-2.5" />}
              date={issue.updatedAt}
              title="Updated"
            />
          )}
        </div>
      )}
    </>
  );
}
