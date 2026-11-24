import { type IssueGroup } from '@/utils/team';
import { usePermissions } from '@/hooks/usePermissions';
import { ListDropZone } from './ListDropZone';
import { ListGroupHeader } from './ListGroupHeader';

// A primary group header in the team list. A drop onto it appends to the group
// (disabled when sub-grouped, where issues live under sub-headers).
export function ListSectionHeader({
  group,
  count,
  collapsed,
  disabled,
  dropId,
  onDrop,
  onToggle,
  onAddIssue,
  readOnly,
  controls,
}: {
  group: IssueGroup;
  count: number;
  collapsed: boolean;
  disabled: boolean;
  dropId: string;
  onDrop: (issueId: string) => void;
  onToggle: () => void;
  onAddIssue?: () => void;
  // In a read-only share the add affordance is hidden.
  readOnly?: boolean;
  controls?: string;
}) {
  const { can } = usePermissions();
  const canCreateIssue = can('work_items', 'create') && !readOnly && onAddIssue != null;
  return (
    <ListDropZone id={dropId} disabled={disabled} onDrop={onDrop}>
      <ListGroupHeader
        group={group}
        count={count}
        collapsed={collapsed}
        onToggle={onToggle}
        onAddIssue={canCreateIssue ? onAddIssue : undefined}
        controls={controls}
      />
    </ListDropZone>
  );
}
