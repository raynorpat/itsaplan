'use client';

import { useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { EmptyState } from '@/components/common/page/EmptyState';
import { Button } from '@/components/ui/button';
import { useListKeyboard } from '@/hooks/useListKeyboard';
import { visibleIssues } from '@/utils/completedIssues';
import { rememberListOrder } from '@/utils/issueNavigation';
import { listRowProperties, toggledKeys } from '@/utils/list';
import { issuePath } from '@/utils/paths';
import type { ViewSettings } from '@/utils/viewSettings';
import { useMyIssues } from '../services/myIssues.service';
import { groupMyIssues, myIssuesGrouping, sortMyIssues, type MyIssuesTab } from '../utils/myIssues';
import MyIssuesGroup from './MyIssuesGroup';
import MyIssuesRow from './MyIssuesRow';

const EMPTY: Record<MyIssuesTab, string> = {
  assigned: 'Issues assigned to you appear here.',
  created: 'Issues you create appear here.',
  subscribed: 'Issues you subscribe to appear here.',
  activity: 'Issues you are involved in appear here, newest change first.',
};

// The tab's issues in the viewer's display: grouped and ordered as chosen, except
// Activity, which is one list by the time of the last change. Issues load a page at
// a time; the Completed issues window and Show sub-issues apply to the loaded ones.
// J / K / Enter move through and open them as on a team's list; there is no
// selection, since bulk edits work on one team's issues and these span teams.
export default function MyIssuesList({
  tab,
  settings,
  onSettingsChange,
}: {
  tab: MyIssuesTab;
  settings: ViewSettings;
  onSettingsChange: (settings: ViewSettings) => void;
}) {
  const router = useRouter();
  const { issues, isPending, error, hasNextPage, fetchNextPage, isFetchingNextPage } = useMyIssues(
    tab,
    settings.completedIssues !== 'none',
  );
  const { completedIssues, showSubIssues, sort, group, collapsedGroups } = settings;
  const shown = useMemo(
    () => visibleIssues(issues, { completedIssues, showSubIssues }, new Date()),
    [issues, completedIssues, showSubIssues],
  );
  const groups = useMemo(
    () => groupMyIssues(sortMyIssues(shown, sort), myIssuesGrouping(group)),
    [shown, sort, group],
  );
  const grouped = tab !== 'activity' && myIssuesGrouping(group) !== 'none';
  const rows = useMemo(
    () =>
      (tab === 'activity'
        ? shown
        : groups.flatMap((g) => (grouped && collapsedGroups.includes(g.key) ? [] : g.issues))
      ).map((i) => ({ id: i.id, identifier: i.identifier })),
    [tab, shown, groups, grouped, collapsedGroups],
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

  const properties = listRowProperties(settings.properties, true);
  const flat = tab === 'activity' ? shown : grouped ? null : (groups[0]?.issues ?? []);

  if (isPending) return null;
  if (error) return <p className="p-6 text-sm text-destructive">{error.message}</p>;
  if (shown.length === 0) return <EmptyState title="No issues" description={EMPTY[tab]} />;
  return (
    <div data-list-root role="list" aria-label="Issues" className="overflow-y-auto">
      {flat
        ? flat.map((issue) => (
            <MyIssuesRow
              key={issue.id}
              issue={issue}
              focused={focused === issue.id}
              properties={properties}
            />
          ))
        : groups.map((g) => (
            <MyIssuesGroup
              key={g.key}
              group={g}
              focused={focused}
              properties={properties}
              collapsed={collapsedGroups.includes(g.key)}
              onToggle={() =>
                onSettingsChange({
                  ...settings,
                  collapsedGroups: toggledKeys(collapsedGroups, g.key),
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
