import { ChevronDown, ChevronRight } from 'lucide-react';
import { type IssueGroup } from '@/utils/team';
import { GroupDot } from '@/components/common/board/shared/GroupDot';
import { ListDropZone } from './ListDropZone';

// A sub-group header row (only present when sub-grouped). A drop onto it appends
// to the sub-group's bucket.
export function ListSubHeader({
  sub,
  count,
  collapsed,
  dropId,
  onDrop,
  onToggle,
  controls,
}: {
  sub: IssueGroup;
  count: number;
  collapsed: boolean;
  dropId: string;
  onDrop: (issueId: string) => void;
  onToggle: () => void;
  controls?: string;
}) {
  return (
    <ListDropZone
      id={dropId}
      onDrop={onDrop}
      className="flex items-center bg-muted/20 py-1 pr-4 pl-10"
    >
      <button
        type="button"
        aria-controls={controls}
        onClick={onToggle}
        className="flex items-center gap-2 text-xs font-medium text-muted-foreground"
      >
        {collapsed ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}
        <GroupDot group={sub} />
        {sub.name}
        <span className="text-muted-foreground/70">{count}</span>
      </button>
    </ListDropZone>
  );
}
