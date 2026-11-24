'use client';

import { useParams, useRouter } from 'next/navigation';
import { useShell } from '@/context/shellContext';
import { teamPath } from '@/utils/paths';
import { useExitOnEscape } from '@/hooks/useExitOnEscape';
import { useIssueBySeqQuery, useIssueQuery } from '@/services/issues.service';
import PageHeaderPortal from '@/components/layout/PageHeaderPortal';
import IssueActionsMenu from './components/actions/IssueActionsMenu';
import IssueDetailContent from './components/detail/IssueDetailContent';

// The full-page issue view (/team/:teamKey/issue/:sequenceNumber), rendered
// inside the Shell layout. The URL carries the team-scoped number, resolved to
// the issue here; the team comes from the Shell. Escape returns to the work
// items view. The issue's ⋯ menu sits on the page header line, as in Linear.
export default function IssueViewPage() {
  const router = useRouter();
  const params = useParams();
  const { team } = useShell();
  const seq = Number(typeof params.issueId === 'string' ? params.issueId : NaN);

  const exit = () => team && router.push(teamPath(team.team.key));
  useExitOnEscape(exit);

  const issueQuery = useIssueBySeqQuery(team?.team.key ?? null, Number.isNaN(seq) ? null : seq);
  // The by-id cache the detail keeps fresh, so the menu sees archive changes at once.
  const issue = useIssueQuery(issueQuery.data?.id ?? null).data;

  if (!team) return null;

  return (
    <div className="flex-1 overflow-y-auto">
      {issue && (
        <PageHeaderPortal>
          <div className="ml-auto flex items-center gap-1">
            <IssueActionsMenu team={team} issue={issue} onDeleted={exit} />
          </div>
        </PageHeaderPortal>
      )}
      <div className="flex flex-col px-8 py-6 xl:px-12">
        {issueQuery.data ? (
          <IssueDetailContent
            team={team}
            issueId={issueQuery.data.id}
            layout="page"
            onDeleted={exit}
          />
        ) : (
          <div className="py-6 text-sm text-muted-foreground">
            {issueQuery.isLoading ? 'Loading…' : 'Issue not found.'}
          </div>
        )}
      </div>
    </div>
  );
}
