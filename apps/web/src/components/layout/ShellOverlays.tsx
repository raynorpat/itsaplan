'use client';

import { useRouter } from 'next/navigation';
import type { TeamDetail } from '@/lib/api';
import { issuePath, teamPath } from '@/utils/paths';
import type { useOverlays } from '@/hooks/useOverlays';
import NewTeamModal from '@/components/layout/NewTeamModal';
import NewIssueModal from '@/features/issue/components/create/NewIssueModal';
import IssueDetail from '@/features/issue/components/detail/IssueDetail';

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
