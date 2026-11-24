import Link from 'next/link';
import { cn } from '@/lib/utils';
import { issuePath } from '@/utils/paths';
import type { ListRowProperties } from '@/utils/list';
import { ListRowContent } from '@/components/common/board/list/ListRowContent';
import type { MyIssue } from '../services/myIssues.service';
import { myIssueRow } from '../utils/myIssues';

// One issue as a row of the shared list, linking to the issue.
export default function MyIssuesRow({
  issue,
  focused,
  properties,
}: {
  issue: MyIssue;
  focused: boolean;
  properties: ListRowProperties;
}) {
  return (
    <Link
      href={issuePath(issue.teamKey, issue.number)}
      data-issue-id={issue.id}
      aria-current={focused || undefined}
      className={cn(
        'block border-b border-border/50 hover:bg-accent/40',
        focused && 'bg-accent/60',
      )}
    >
      <ListRowContent data={myIssueRow(issue)} properties={properties} />
    </Link>
  );
}
