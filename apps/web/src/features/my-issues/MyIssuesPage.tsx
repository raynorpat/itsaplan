import type { MyIssuesTab } from './utils/myIssues';
import MyIssuesTabs from './components/MyIssuesTabs';
import MyIssuesList from './components/MyIssuesList';

// Linear's "My issues" (/my-issues): the viewer's issues across every team, in
// four tabs.
export default function MyIssuesPage({ tab }: { tab: MyIssuesTab }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <MyIssuesTabs active={tab} />
      <MyIssuesList tab={tab} />
    </div>
  );
}
