import type { StateType } from '@/types/team';
import { StateIcon } from '@/components/common/issue/IssueIcons';
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

// A status group: a header with the status and its count, then its rows.
export default function MyIssuesGroup({ type, issues }: { type: string; issues: MyIssue[] }) {
  return (
    <section>
      <h2 className="flex h-9 items-center gap-2 bg-muted/40 px-6 text-sm font-medium">
        <StateIcon stateType={type as StateType} color={issues[0]?.state.color ?? 'currentColor'} />
        {LABELS[type] ?? type}
        <span className="text-muted-foreground">{issues.length}</span>
      </h2>
      {issues.map((issue) => (
        <MyIssuesRow key={issue.id} issue={issue} />
      ))}
    </section>
  );
}
