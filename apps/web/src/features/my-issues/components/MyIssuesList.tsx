'use client';

import { EmptyState } from '@/components/common/page/EmptyState';
import { useMyIssues } from '../services/myIssues.service';
import { groupByStateType, type MyIssuesTab } from '../utils/myIssues';
import MyIssuesGroup from './MyIssuesGroup';
import MyIssuesRow from './MyIssuesRow';

const EMPTY: Record<MyIssuesTab, string> = {
  assigned: 'Issues assigned to you appear here.',
  created: 'Issues you create appear here.',
  subscribed: 'Issues you subscribe to appear here.',
  activity: 'Issues you are involved in appear here, newest change first.',
};

// The tab's issues: grouped by status, except Activity, which is one list by the
// time of the last change.
export default function MyIssuesList({ tab }: { tab: MyIssuesTab }) {
  const { data, isPending, error } = useMyIssues(tab);
  if (isPending) return null;
  if (error) return <p className="p-6 text-sm text-destructive">{error.message}</p>;
  if (data.length === 0) return <EmptyState title="No issues" description={EMPTY[tab]} />;
  if (tab === 'activity')
    return (
      <div className="overflow-y-auto">
        {data.map((issue) => (
          <MyIssuesRow key={issue.id} issue={issue} />
        ))}
      </div>
    );
  return (
    <div className="overflow-y-auto">
      {groupByStateType(data).map((g) => (
        <MyIssuesGroup key={g.type} type={g.type} issues={g.issues} />
      ))}
    </div>
  );
}
