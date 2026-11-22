import { useCallback, useContext } from 'react';
import { ShellCtx } from '@/context/shellContext';
import type { TeamDetail } from '@/lib/api';
import { isWorkspaceAdmin } from '@/utils/workspaceRoles';

// The areas of a team the UI gates, and the actions on them.
export type AccessArea =
  | 'work_items'
  | 'projects'
  | 'views'
  | 'members_invite'
  | 'members_manage'
  | 'states'
  | 'labels'
  | 'webhooks'
  | 'danger_zone';
export type AccessAction = 'create' | 'edit' | 'read' | 'delete';

// The current user's access in the active team, from the payload the Shell loads
// (team.viewer), following Linear's rules: anyone who can see a team works in it
// (issues, projects, views); team managers (team owners, workspace admins and
// owners, or any member of a team without owners) change its settings, states,
// labels and members; inviting needs a role above guest; webhooks need a workspace
// admin. Everyone who can see a team reads every area.
//
// These checks gate UI only; the API enforces the same rules on every request.
//
// The team is read from the Shell context. Pass `source` where the context is not
// readable yet (the Shell itself). Without either one every check is false.
export function usePermissions(source?: TeamDetail | null) {
  const ctx = useContext(ShellCtx);
  const team = source ?? ctx?.team ?? null;
  const viewer = team?.viewer ?? null;

  const can = useCallback(
    (area: AccessArea, action: AccessAction) => {
      if (viewer == null) return false;
      if (action === 'read') return true;
      switch (area) {
        case 'work_items':
        case 'projects':
        case 'views':
          return true;
        case 'members_invite':
          return viewer.workspaceRole !== 'guest';
        case 'webhooks':
          return isWorkspaceAdmin(viewer.workspaceRole);
        default:
          return viewer.canManage;
      }
    },
    [viewer],
  );

  return {
    can,
    role: viewer?.role ?? null,
    canManage: viewer?.canManage ?? false,
    workspaceRole: viewer?.workspaceRole ?? null,
  };
}
