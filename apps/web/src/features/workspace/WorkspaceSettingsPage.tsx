'use client';

import { useSession } from '@/lib/auth-client';
import { isWorkspaceAdmin, toWorkspaceRole } from '@/utils/workspaceRoles';
import SectionPageView from '@/components/common/page/SectionPageView';
import SettingsSection from '@/components/common/page/SettingsSection';
import { useOrganizationQuery } from './services/organization.service';
import WorkspaceAbout from './components/WorkspaceAbout';
import WorkspaceGeneralForm from './components/WorkspaceGeneralForm';
import WorkspacePermissions from './components/WorkspacePermissions';
import WorkspaceSignInMethods from './components/WorkspaceSignInMethods';
import WorkspaceUploadTypes from './components/WorkspaceUploadTypes';

// The workspace settings page (/settings/workspace/general), Linear's Organization settings.
// Owners and admins change them; the API refuses everyone else.
export default function WorkspaceSettingsPage() {
  const { data: session, isPending } = useSession();
  const isAdmin = isWorkspaceAdmin(toWorkspaceRole(session?.user.workspaceRole));
  const { data: org } = useOrganizationQuery();

  return (
    <SectionPageView
      title="Workspace settings"
      description="The workspace name, how people sign in, what they may upload, and who may create teams, manage labels and invite."
    >
      {(isPending || (isAdmin && !org)) && (
        <p className="text-sm text-muted-foreground">Loading…</p>
      )}
      {!isPending && !isAdmin && (
        <p className="text-sm text-muted-foreground">
          Only workspace owners and admins can change these settings.
        </p>
      )}
      {isAdmin && org && (
        <div className="flex flex-col gap-10">
          <SettingsSection title="General">
            <WorkspaceGeneralForm org={org} />
          </SettingsSection>
          <SettingsSection title="Sign-in methods">
            <WorkspaceSignInMethods org={org} />
          </SettingsSection>
          <SettingsSection title="Permissions">
            <WorkspacePermissions org={org} />
          </SettingsSection>
          <SettingsSection title="Uploads">
            <WorkspaceUploadTypes org={org} />
          </SettingsSection>
          <SettingsSection title="About">
            <WorkspaceAbout org={org} />
          </SettingsSection>
        </div>
      )}
    </SectionPageView>
  );
}
