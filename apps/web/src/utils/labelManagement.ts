import type { WorkspaceRole } from '@/types/workspace';
import { atLeast } from '@/utils/workspaceRoles';

// Whether the viewer may manage workspace labels and project labels: the
// organization's labelManagementRole (Linear's UserRoleType, where `user` is a
// member) or higher. Guests never may; an unknown role or setting refuses.
export function canManageLabels(
  role: WorkspaceRole | null,
  labelManagementRole: string | undefined,
): boolean {
  if (!role || role === 'guest' || !labelManagementRole) return false;
  const minimum = labelManagementRole === 'user' ? 'member' : labelManagementRole;
  if (minimum !== 'member' && minimum !== 'admin' && minimum !== 'owner') return false;
  return atLeast(role, minimum);
}
