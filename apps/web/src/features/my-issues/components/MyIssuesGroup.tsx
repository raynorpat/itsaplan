import { useState } from 'react';
import type { StateType } from '@/types/team';
import { ListGroupHeader } from '@/components/common/board/list/ListGroupHeader';
import type { MyIssue } from '../services/myIssues.service';
import MyIssuesRow from './MyIssuesRow';

const LABELS: Record<string, string> = {
  triage: 'Triage',
  started: 'In Progress',
  unstarted: 'Todo',
  backlog: 'Backlog',
  completed: 'Done',
  canceled: 'Canceled',
};

// A status group of the shared list: its header (collapsible) and its rows.
export default function MyIssuesGroup({ type, issues }: { type: string; issues: MyIssue[] }) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <section>
      <ListGroupHeader
        group={{
          key: type,
          name: LABELS[type] ?? type,
          stateType: type as StateType,
          color: issues[0]?.state.color,
          assign: null,
        }}
        count={issues.length}
        collapsed={collapsed}
        onToggle={() => setCollapsed((c) => !c)}
      />
      {!collapsed && issues.map((issue) => <MyIssuesRow key={issue.id} issue={issue} />)}
    </section>
  );
}
