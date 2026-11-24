'use client';

import { EmptyState } from '@/components/common/page/EmptyState';
import { Button } from '@/components/ui/button';
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
// time of the last change. Issues load a page at a time.
export default function MyIssuesList({
  tab,
  includeCompleted,
}: {
  tab: MyIssuesTab;
  includeCompleted: boolean;
}) {
  const { issues, isPending, error, hasNextPage, fetchNextPage, isFetchingNextPage } = useMyIssues(
    tab,
    includeCompleted,
  );
  if (isPending) return null;
  if (error) return <p className="p-6 text-sm text-destructive">{error.message}</p>;
  if (issues.length === 0) return <EmptyState title="No issues" description={EMPTY[tab]} />;
  return (
    <div className="overflow-y-auto">
      {tab === 'activity'
        ? issues.map((issue) => <MyIssuesRow key={issue.id} issue={issue} />)
        : groupByStateType(issues).map((g) => (
            <MyIssuesGroup key={g.type} type={g.type} issues={g.issues} />
          ))}
      {hasNextPage && (
        <div className="flex justify-center p-3">
          <Button
            variant="ghost"
            size="sm"
            disabled={isFetchingNextPage}
            onClick={() => void fetchNextPage()}
          >
            {isFetchingNextPage ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      )}
    </div>
  );
}
