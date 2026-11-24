import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, Maximize2, X } from 'lucide-react';
import type { TeamDetail } from '@/types/team';
import type { IssueDetail as IssueDetailRow } from '@/types/issue';
import IssueDetailContent from './IssueDetailContent';
import IssueActionsMenu from '../actions/IssueActionsMenu';
import { useExitOnEscape } from '@/hooks/useExitOnEscape';
import { Button } from '@/components/ui/button';
import { useHotkeyCombos } from '@/context/useHotkeys';
import { peekKeyAction } from '@/utils/list';
import {
  issuePathFromIdentifier,
  readListOrder,
  stepFrom,
  type ListOrderEntry,
} from '@/utils/issueNavigation';
import { useSubIssuesQuery } from '@/services/issues.service';

// The issue detail as a right-hand side panel over the team (Linear's peek). Expand
// opens the same issue as a full page; the shared body lives in IssueDetailContent.
// J / K show the next / previous issue of the list it was opened from (`onNavigate`),
// Space and Escape close it.
export default function IssueDetail({
  team,
  issueId,
  onClose,
  onExpand,
  onNavigate,
}: {
  team: TeamDetail;
  issueId: string;
  onClose: () => void;
  // Passed the issue's team-scoped number so the host can open the page URL
  // (/team/KEY/issue/42); null while the issue is still loading.
  onExpand: (sequenceNumber: number | null) => void;
  onNavigate: (issueId: string) => void;
}) {
  const [loaded, setLoaded] = useState<IssueDetailRow | null>(null);
  // After J / K the previous issue stays in `loaded` until the next one arrives; the
  // header and its actions only act on the issue the panel is showing.
  const issue = loaded?.id === issueId ? loaded : null;
  const parent = useSubIssuesQuery(issueId).data?.parent ?? null;
  const combos = useHotkeyCombos();

  useExitOnEscape(onClose);

  // The list order as it was while it still held the shown issue, so J / K keep
  // moving after the issue leaves the list (set to Done, archived).
  const snapshot = useRef<ListOrderEntry[]>([]);
  useEffect(() => {
    const order = readListOrder();
    if (order.some((e) => e.id === issueId)) snapshot.current = order;
  }, [issueId]);

  const latest = useRef({ issueId, onClose, onNavigate });
  latest.current = { issueId, onClose, onNavigate };
  useEffect(() => {
    // In the capture phase, so the key is marked handled before the list behind the
    // panel sees it and moves its own focus a second time.
    const onKey = (e: KeyboardEvent) => {
      const action = peekKeyAction(e, combos);
      // Escape is left to useExitOnEscape, which lets an open popover close first.
      if (action == null || e.key === 'Escape') return;
      e.preventDefault();
      const k = latest.current;
      if (action === 'close') {
        k.onClose();
        return;
      }
      const order = readListOrder();
      if (order.some((entry) => entry.id === k.issueId)) snapshot.current = order;
      const target = stepFrom(order, snapshot.current, k.issueId, action === 'next' ? 1 : -1);
      if (target) k.onNavigate(target.id);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [combos]);

  return (
    <div
      className="fixed inset-0 z-40 flex"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      {/* No padding at the top: the sticky header carries it, so it can sit flush
          against the panel edge with nothing showing above it. */}
      {/* A region, not a dialog: the peek is a non-modal preview, and J / K / Space
          keep working inside it (blocksShortcuts skips keys inside dialogs). */}
      <div
        role="region"
        aria-label={issue ? `Issue ${issue.identifier}` : 'Issue'}
        className="ml-auto flex h-full w-full flex-col overflow-y-auto border-l bg-card px-5 pt-0 pb-5 sm:w-[720px] sm:max-w-[92vw] sm:px-8"
      >
        {/* The header stays at the top while the body scrolls under it. Negative
            margins cancel the panel padding so its translucent, blurred backdrop
            spans the full panel width. */}
        <div className="sticky top-0 z-10 -mx-5 mb-3 flex items-center justify-between gap-2 bg-card/85 px-5 pt-5 pb-3 backdrop-blur-md sm:-mx-8 sm:px-8">
          <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
            {issue && parent && (
              <>
                <Link
                  href={issuePathFromIdentifier(parent.identifier)}
                  className="hover:text-foreground"
                  title={parent.title}
                >
                  {parent.identifier}
                </Link>
                <ChevronRight className="size-3 shrink-0" />
              </>
            )}
            {issue?.identifier ?? ''}
          </span>
          <div className="flex items-center gap-1">
            {issue && (
              <>
                <IssueActionsMenu team={team} issue={issue} onDeleted={onClose} />
                <div className="mx-1 h-5 w-px bg-border" />
              </>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground hover:text-foreground"
              onClick={() => onExpand(issue?.sequenceNumber ?? null)}
              title="Open as page"
            >
              <Maximize2 />
            </Button>
            <Button variant="ghost" size="icon" className="size-7" onClick={onClose} title="Close">
              <X />
            </Button>
          </div>
        </div>

        <IssueDetailContent
          team={team}
          issueId={issueId}
          onIssueLoaded={setLoaded}
          onDeleted={onClose}
        />
      </div>
    </div>
  );
}
