import { useCallback, useContext } from 'react';
import { ShellCtx } from '@/context/shellContext';
import type { PermissionAction, PermissionResource, TeamDetail } from '@/lib/api';

// The current user's effective access in the active team, read from the payload
// the Shell loads (team.viewer). Owners bypass the matrix (can everything); a
// member is checked against their role's resource x action flags.
//
// These checks gate UI only — hiding a control is convenience, not security. The
// API enforces the same matrix on every request, so a hidden action is also a 403
// if called directly. Mirror the backend one-to-one: can('work_items', 'edit')
// matches the route guard permission: ['work_items', 'edit'].
//
// The team is read from the Shell context. Pass `source` where the context is
// not readable yet (the Shell itself, which renders the provider). Without either
// one every check is false: no team loaded means no permissions.
export function usePermissions(source?: TeamDetail | null) {
  const ctx = useContext(ShellCtx);
  const team = source ?? ctx?.team ?? null;
  const viewer = team?.viewer ?? null;
  const permissions = team?.permissions ?? null;

  const can = useCallback(
    (resource: PermissionResource, action: PermissionAction) =>
      viewer != null && (viewer.role === 'owner' || permissions?.[resource]?.[action] === true),
    [viewer, permissions],
  );

  return { can, role: viewer?.role ?? null, isOwner: viewer?.role === 'owner' };
}
