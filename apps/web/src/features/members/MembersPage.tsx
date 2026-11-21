'use client';

import { useShell } from '@/context/shellContext';
import SectionPageView from '@/components/common/page/SectionPageView';
import InvitesManager from './components/invites/InvitesManager';
import MembersList from './components/members/MembersList';

// The Members page (/team/:teamKey/members): who has access to the team.
// Pending invites and the invite form sit above the members list.
export default function MembersPage() {
  const { team } = useShell();
  if (!team) return null;
  return (
    <SectionPageView
      title="Members"
      description="People with access to this team. Invite people by email; owners can revoke access."
      wide
    >
      <InvitesManager teamKey={team.team.key} />
      <MembersList teamKey={team.team.key} />
    </SectionPageView>
  );
}
