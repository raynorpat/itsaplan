import { usePermissions } from '@/hooks/usePermissions';
import { useMinimumRole } from '@/hooks/useSecuritySettings';
import { canManageLabels } from '@/utils/labelManagement';

// The organization's labelManagementRole against the viewer's workspace role: who may
// manage workspace labels and project labels (the API's assertLabelManager).
export function useCanManageLabels(): boolean {
  const { workspaceRole } = usePermissions();
  return canManageLabels(workspaceRole, useMinimumRole('labelManagementRole'));
}
