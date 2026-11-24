'use client';

import { useState } from 'react';
import { defaultIncludeCompleted, type MyIssuesTab } from './utils/myIssues';
import MyIssuesTabs from './components/MyIssuesTabs';
import MyIssuesList from './components/MyIssuesList';

// Linear's "My issues" (/my-issues): the viewer's issues across every team, in
// four tabs. Each tab keeps its own completed-issues setting, starting from its
// default; the tabs share this component when switching between them.
export default function MyIssuesPage({ tab }: { tab: MyIssuesTab }) {
  const [chosen, setChosen] = useState<Partial<Record<MyIssuesTab, boolean>>>({});
  const includeCompleted = chosen[tab] ?? defaultIncludeCompleted(tab);
  const setIncludeCompleted = (value: boolean) => setChosen((c) => ({ ...c, [tab]: value }));
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <MyIssuesTabs
        active={tab}
        includeCompleted={includeCompleted}
        onIncludeCompletedChange={setIncludeCompleted}
      />
      <MyIssuesList tab={tab} includeCompleted={includeCompleted} />
    </div>
  );
}
