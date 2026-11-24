import Link from 'next/link';
import { cn } from '@/lib/utils';
import { issuePath } from '@/utils/paths';
import { listRowProperties } from '@/utils/list';
import { defaultViewSettings } from '@/utils/viewSettings';
import { ListRowContent } from '@/components/common/board/list/ListRowContent';
import type { MyIssue } from '../services/myIssues.service';
import { myIssueRow } from '../utils/myIssues';

// The fields My issues shows: the List layout's defaults.
const PROPERTIES = listRowProperties(defaultViewSettings('list').properties, true);

// One issue as a row of the shared list, linking to the issue.
export default function MyIssuesRow({ issue, focused }: { issue: MyIssue; focused: boolean }) {
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
      <ListRowContent data={myIssueRow(issue)} properties={PROPERTIES} />
    </Link>
  );
}
