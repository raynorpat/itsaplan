'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { TeamDetail } from '@/types/team';
import { issuePath, teamPath } from '@/utils/paths';
import type { useOverlays } from '@/hooks/useOverlays';
import NewTeamModal from '@/components/layout/NewTeamModal';
import NewIssueModal from '@/features/issue/components/create/NewIssueModal';
import IssueDetail from '@/features/issue/components/detail/IssueDetail';
import { rememberListFocus } from '@/utils/listFocus';

// The team-level overlays the Shell mounts above its content: the new-team
// modal, the new-issue modal and the issue detail panel.
// Each renders only while its overlay state says it is open.
export default function ShellOverlays({
  team,
  teamKey,
  overlays,
}: {
  team: TeamDetail | null;
  teamKey: string | null;
  overlays: ReturnType<typeof useOverlays>;
}) {
  const router = useRouter();
  // The list behind the panel is keyed by this page's path (see useListKeyboard).
  const pathname = usePathname();

  // A link inside the panel (a sub-issue, the parent, a relation) opens another page;
  // the panel closes instead of staying over it.
  const { setOpenIssueId } = overlays;
  const shownPath = useRef(pathname);
  useEffect(() => {
    if (shownPath.current === pathname) return;
    shownPath.current = pathname;
    setOpenIssueId(null);
  }, [pathname, setOpenIssueId]);

  return (
    <>
      {overlays.showNewTeam && (
        <NewTeamModal
          onClose={() => overlays.setShowNewTeam(false)}
          onCreated={(key) => {
            overlays.setShowNewTeam(false);
            router.push(teamPath(key));
          }}
        />
      )}

      {team && overlays.newIssueDefaults != null && (
        <NewIssueModal
          team={team}
          defaults={overlays.newIssueDefaults}
          onClose={() => overlays.setNewIssueDefaults(null)}
          onCreated={() => overlays.setNewIssueDefaults(null)}
        />
      )}

      {team && overlays.openIssueId != null && (
        <IssueDetail
          team={team}
          issueId={overlays.openIssueId}
          onClose={() => overlays.setOpenIssueId(null)}
          onNavigate={(id) => {
            overlays.setOpenIssueId(id);
            rememberListFocus(pathname, id);
          }}
          onExpand={(seq) => {
            // Prefer the number the panel loaded; fall back to the board issue.
            const n =
              seq ?? team.issues.find((i) => i.id === overlays.openIssueId)?.sequenceNumber ?? null;
            if (teamKey && n != null) router.push(issuePath(teamKey, n));
            overlays.setOpenIssueId(null);
          }}
        />
      )}
    </>
  );
}
