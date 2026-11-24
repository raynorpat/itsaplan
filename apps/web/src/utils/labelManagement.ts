import type { WorkspaceRole } from '@/types/workspace';
import { meetsMinimumRole } from '@/utils/workspaceRoles';

// Whether the viewer may manage workspace labels and project labels: the
// organization's labelManagementRole or higher.
export function canManageLabels(
  role: WorkspaceRole | null,
  labelManagementRole: string | undefined,
): boolean {
  return meetsMinimumRole(role, labelManagementRole);
}
