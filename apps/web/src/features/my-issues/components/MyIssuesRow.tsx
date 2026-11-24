import Link from 'next/link';
import { issuePath } from '@/utils/paths';
import { listRowProperties } from '@/utils/list';
import { defaultViewSettings } from '@/utils/viewSettings';
import { ListRowContent } from '@/components/common/board/list/ListRowContent';
import type { MyIssue } from '../services/myIssues.service';
import { myIssueRow } from '../utils/myIssues';

// The fields My issues shows: the List layout's defaults.
const PROPERTIES = listRowProperties(defaultViewSettings('list').properties, true);

// One issue as a row of the shared list, linking to the issue.
export default function MyIssuesRow({ issue }: { issue: MyIssue }) {
  return (
    <Link
      href={issuePath(issue.teamKey, issue.number)}
      className="block border-b border-border/50 hover:bg-accent/40"
    >
      <ListRowContent data={myIssueRow(issue)} properties={PROPERTIES} />
    </Link>
  );
}
