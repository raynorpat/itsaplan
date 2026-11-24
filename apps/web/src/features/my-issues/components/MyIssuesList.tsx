'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { EmptyState } from '@/components/common/page/EmptyState';
import { Button } from '@/components/ui/button';
import { useListKeyboard } from '@/hooks/useListKeyboard';
import { rememberListOrder } from '@/utils/issueNavigation';
import { issuePath } from '@/utils/paths';
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
// time of the last change. Issues load a page at a time. J / K / Enter move through
// and open them as on a team's list; there is no selection, since bulk edits work on
// one team's issues and these span teams.
export default function MyIssuesList({
  tab,
  includeCompleted,
}: {
  tab: MyIssuesTab;
  includeCompleted: boolean;
}) {
  const router = useRouter();
  const { issues, isPending, error, hasNextPage, fetchNextPage, isFetchingNextPage } = useMyIssues(
    tab,
    includeCompleted,
  );
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const groups = useMemo(() => groupByStateType(issues), [issues]);
  const rows = useMemo(
    () =>
      (tab === 'activity'
        ? issues
        : groups.flatMap((g) => (collapsed.has(g.type) ? [] : g.issues))
      ).map((i) => ({ id: i.id, identifier: i.identifier })),
    [tab, issues, groups, collapsed],
  );
  const order = useMemo(() => rows.map((r) => r.id), [rows]);
  // The issue page moves through these rows (previous / next).
  useEffect(() => rememberListOrder(rows), [rows]);
  const { focused } = useListKeyboard({
    order,
    onOpen: (id) => {
      const issue = issues.find((i) => i.id === id);
      if (issue) router.push(issuePath(issue.teamKey, issue.number));
    },
    onFocusMove: (id) =>
      document.querySelector(`[data-issue-id="${id}"]`)?.scrollIntoView({ block: 'nearest' }),
  });

  if (isPending) return null;
  if (error) return <p className="p-6 text-sm text-destructive">{error.message}</p>;
  if (issues.length === 0) return <EmptyState title="No issues" description={EMPTY[tab]} />;
  return (
    <div data-list-root role="list" aria-label="Issues" className="overflow-y-auto">
      {tab === 'activity'
        ? issues.map((issue) => (
            <MyIssuesRow key={issue.id} issue={issue} focused={focused === issue.id} />
          ))
        : groups.map((g) => (
            <MyIssuesGroup
              key={g.type}
              type={g.type}
              issues={g.issues}
              focused={focused}
              collapsed={collapsed.has(g.type)}
              onToggle={() =>
                setCollapsed((prev) => {
                  const next = new Set(prev);
                  if (!next.delete(g.type)) next.add(g.type);
                  return next;
                })
              }
            />
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
