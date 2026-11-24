import { ListGroupHeader } from '@/components/common/board/list/ListGroupHeader';
import type { ListRowProperties } from '@/utils/list';
import type { MyIssue } from '../services/myIssues.service';
import type { MyIssuesGroupData } from '../utils/myIssues';
import MyIssuesRow from './MyIssuesRow';

// A group of the shared list: its header (collapsible) and its rows.
export default function MyIssuesGroup({
  group,
  focused,
  collapsed,
  onToggle,
  properties,
}: {
  group: MyIssuesGroupData<MyIssue>;
  focused: string | null;
  collapsed: boolean;
  onToggle: () => void;
  properties: ListRowProperties;
}) {
  return (
    <section>
      <ListGroupHeader
        group={{
          key: group.key,
          name: group.name,
          stateType: group.stateType,
          priority: group.priority,
          color: group.color,
          assign: null,
        }}
        count={group.issues.length}
        collapsed={collapsed}
        onToggle={onToggle}
      />
      {!collapsed &&
        group.issues.map((issue) => (
          <MyIssuesRow
            key={issue.id}
            issue={issue}
            focused={focused === issue.id}
            properties={properties}
          />
        ))}
    </section>
  );
}
