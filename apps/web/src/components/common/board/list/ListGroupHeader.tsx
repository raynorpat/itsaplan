import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { type IssueGroup } from '@/utils/team';
import { Button } from '@/components/ui/button';
import { GroupDot } from '@/components/common/board/shared/GroupDot';

// A list group header, as in Linear: a collapse toggle with the group's icon,
// name and issue count, and a + that adds an issue to the group when offered.
export function ListGroupHeader({
  group,
  count,
  collapsed,
  onToggle,
  onAddIssue,
  controls,
}: {
  group: Pick<IssueGroup, 'name' | 'color' | 'stateType' | 'priority' | 'key' | 'assign'>;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  onAddIssue?: () => void;
  // The id of the list the group's rows sit in, for assistive tech.
  controls?: string;
}) {
  return (
    <div className="group/header flex h-9 items-center justify-between bg-muted/40 pr-3 pl-4">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        aria-controls={controls}
        className="flex items-center gap-2 text-sm font-medium text-foreground"
      >
        {collapsed ? (
          <ChevronRight className="size-3.5 text-muted-foreground" />
        ) : (
          <ChevronDown className="size-3.5 text-muted-foreground" />
        )}
        <GroupDot group={group as IssueGroup} />
        {group.name}
        <span className="font-normal text-muted-foreground">{count}</span>
      </button>
      {onAddIssue && (
        <Button
          variant="ghost"
          size="icon"
          className="size-6 text-muted-foreground opacity-0 group-hover/header:opacity-100 focus-visible:opacity-100"
          onClick={onAddIssue}
          title="New issue"
        >
          <Plus />
        </Button>
      )}
    </div>
  );
}
