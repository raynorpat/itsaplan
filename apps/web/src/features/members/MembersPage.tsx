'use client';

import { useShell } from '@/context/shellContext';
import { usePermissions } from '@/hooks/usePermissions';
import SectionPageView from '@/components/common/page/SectionPageView';
import MemberAddForm from './components/members/MemberAddForm';
import MembersList from './components/members/MembersList';

// The Members page (/settings/teams/:teamKey/members): who is in the team. Any member of a
// public team adds people from the workspace; a private team's managers do. New
// people are invited from the workspace Members page.
export default function MembersPage() {
  const { team } = useShell();
  const { canManage, workspaceRole, role } = usePermissions();
  if (!team) return null;
  const isPublic = team.team.visibility === 'public';
  const canAdd =
    workspaceRole != null && workspaceRole !== 'guest' && (canManage || (isPublic && role != null));
  return (
    <SectionPageView
      title="Members"
      description="People in this team. Team owners and workspace admins manage the team; anyone can leave."
      wide
    >
      {canAdd && <MemberAddForm teamKey={team.team.key} />}
      <MembersList teamKey={team.team.key} />
    </SectionPageView>
  );
}
