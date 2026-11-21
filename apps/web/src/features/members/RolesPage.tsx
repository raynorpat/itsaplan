'use client';

import { useShell } from '@/context/shellContext';
import SectionPageView from '@/components/common/page/SectionPageView';
import RolesManager from './components/roles/RolesManager';
import RolesToolbar from './components/roles/RolesToolbar';

// The Roles page (/team/:teamKey/members/roles): the team's custom roles
// and their permissions. Assigning a role to a member is done from the Members list.
export default function RolesPage() {
  const { team } = useShell();
  if (!team) return null;
  const teamKey = team.team.key;
  return (
    <SectionPageView
      title="Roles"
      description="Custom roles and the permissions each grants. Assign a role to a member from the Members list."
      actions={<RolesToolbar teamKey={teamKey} />}
      wide
    >
      <RolesManager teamKey={teamKey} />
    </SectionPageView>
  );
}
