import { DEFAULT_COLOR, type IssueGroup } from '@/utils/team';
import { PriorityIcon, StateIcon } from '@/components/common/issue/IssueIcons';

// The leading marker for a group header: a status icon for status groups, the
// priority icon for priority groups, otherwise a colored dot. Shared by the board columns/swimlanes and the table
// sections.
export function GroupDot({ group }: { group: IssueGroup }) {
  if (group.stateType)
    return (
      <StateIcon
        stateType={group.stateType}
        color={group.color ?? DEFAULT_COLOR}
        className="size-3.5"
      />
    );
  if (group.priority != null)
    return <PriorityIcon priority={group.priority} className="size-3.5 text-muted-foreground" />;
  return (
    <span
      className="inline-block h-2.5 w-2.5 rounded-full border"
      style={{ backgroundColor: group.color ?? 'var(--muted-foreground)' }}
    />
  );
}
