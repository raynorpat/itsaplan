'use client';

import { useSession } from '@/lib/auth-client';
import { toWorkspaceRole } from '@/utils/workspaceRoles';
import FullPageView from '@/components/common/page/FullPageView';
import WorkspaceInviteDialog from './components/WorkspaceInviteDialog';
import WorkspaceInvites from './components/WorkspaceInvites';
import WorkspaceUsersTable from './components/WorkspaceUsersTable';

// The workspace Members page (/workspace/members): everyone in the workspace and
// the pending invites. Owners, admins and members invite (never above their own
// role); owners and admins change roles and suspend. Guests do not see it.
export default function WorkspaceMembersPage() {
  const { data: session, isPending } = useSession();
  const role = toWorkspaceRole(session?.user.workspaceRole);
  const viewerId = session?.user.id ?? null;

  return (
    <FullPageView
      label="Members"
      title="Workspace members"
      description="Everyone in this workspace. Invite people by email with a role and teams; owners and admins change roles and suspend people, which ends their access."
      actions={!isPending && role !== 'guest' ? <WorkspaceInviteDialog viewerRole={role} /> : null}
    >
      {isPending && <p className="text-sm text-muted-foreground">Loading…</p>}
      {!isPending && role === 'guest' && (
        <p className="text-sm text-muted-foreground">Guests cannot see the workspace members.</p>
      )}
      {!isPending && role !== 'guest' && (
        <>
          <WorkspaceInvites viewerRole={role} viewerId={viewerId} />
          <WorkspaceUsersTable viewerRole={role} viewerId={viewerId} />
        </>
      )}
    </FullPageView>
  );
}
