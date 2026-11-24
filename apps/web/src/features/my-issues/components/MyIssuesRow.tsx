import Link from 'next/link';
import type { StateType } from '@/types/team';
import { issuePath } from '@/utils/paths';
import { PriorityIcon, StateIcon } from '@/components/common/issue/IssueIcons';
import Avatar from '@/components/common/Avatar';
import type { MyIssue } from '../services/myIssues.service';

// One issue as a single dense line, as in Linear's list: priority, identifier,
// status, title, then the assignee and the date of the last change.
export default function MyIssuesRow({ issue }: { issue: MyIssue }) {
  return (
    <Link
      href={issuePath(issue.teamKey, issue.number)}
      className="flex h-10 items-center gap-3 px-6 text-sm hover:bg-accent"
    >
      <PriorityIcon priority={issue.priority} className="shrink-0 text-muted-foreground" />
      <span className="w-16 shrink-0 text-xs text-muted-foreground tabular-nums">
        {issue.identifier}
      </span>
      <StateIcon stateType={issue.state.type as StateType} color={issue.state.color} />
      <span className="min-w-0 flex-1 truncate">{issue.title}</span>
      {issue.assignee && <Avatar name={issue.assignee.name} image={issue.assignee.avatarUrl} />}
      <span className="w-14 shrink-0 text-right text-xs text-muted-foreground">
        {new Date(issue.updatedAt).toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
        })}
      </span>
    </Link>
  );
}
