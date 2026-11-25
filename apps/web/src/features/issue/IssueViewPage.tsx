'use client';

import { useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useShell } from '@/context/shellContext';
import { teamPath } from '@/utils/paths';
import { useExitOnEscape } from '@/hooks/useExitOnEscape';
import { useIssueBySeqQuery, useIssueQuery } from '@/services/issues.service';
import PageHeaderPortal from '@/components/layout/PageHeaderPortal';
import FavoriteStarButton from '@/components/common/favorites/FavoriteStarButton';
import { Button } from '@/components/ui/button';
import { useHotkeyCombos } from '@/context/useHotkeys';
import {
  adjacentIssue,
  issuePathFromIdentifier,
  pageNavKey,
  readListOrder,
  type ListOrderEntry,
} from '@/utils/issueNavigation';
import IssueActionsMenu from './components/actions/IssueActionsMenu';
import IssueDetailContent from './components/detail/IssueDetailContent';

// The full-page issue view (/team/:teamKey/issue/:sequenceNumber), rendered
// inside the Shell layout. The URL carries the team-scoped number, resolved to
// the issue here; the team comes from the Shell. Escape returns to the work
// items view. The header line carries the issue's place in the list it was opened
// from ("3 / 15", up / down, J / K) and its ⋯ menu, as in Linear.
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

  const combos = useHotkeyCombos();
  const position = issue ? adjacentIssue(readListOrder(), issue.id) : null;
  const goTo = (entry: ListOrderEntry | null) => {
    if (entry) router.push(issuePathFromIdentifier(entry.identifier));
  };
  const latestRef = useRef({ position, goTo });
  latestRef.current = { position, goTo };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const action = pageNavKey(e, combos);
      const { position: pos, goTo: go } = latestRef.current;
      if (action == null || pos == null) return;
      e.preventDefault();
      go(action === 'next' ? pos.next : pos.prev);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [combos]);

  if (!team) return null;

  return (
    <div className="flex-1 overflow-y-auto">
      {issue && (
        <PageHeaderPortal>
          <div className="ml-auto flex items-center gap-1">
            {position && (
              <div className="mr-1 flex items-center gap-0.5 text-xs text-muted-foreground">
                <span className="mr-1 tabular-nums">
                  {position.index + 1} / {position.total}
                </span>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  title="Previous issue (K)"
                  aria-label="Previous issue"
                  disabled={!position.prev}
                  onClick={() => goTo(position.prev)}
                >
                  <ChevronUp />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  title="Next issue (J)"
                  aria-label="Next issue"
                  disabled={!position.next}
                  onClick={() => goTo(position.next)}
                >
                  <ChevronDown />
                </Button>
              </div>
            )}
            <FavoriteStarButton target={{ kind: 'issue', id: issue.id }} />
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
