import { useQuery } from '@tanstack/react-query';
import { graphql, gqlRequest } from '@/lib/graphql';
import { usePermissions } from '@/hooks/usePermissions';
import { canManageLabels } from '@/utils/labelManagement';

const LabelManagementQuery = graphql(`
  query LabelManagement {
    organization {
      id
      securitySettings
    }
  }
`);

// The organization's labelManagementRole against the viewer's workspace role: who may
// manage workspace labels and project labels (the API's assertLabelManager).
export function useCanManageLabels(): boolean {
  const { workspaceRole } = usePermissions();
  const settings = useQuery({
    queryKey: ['labelManagement'],
    queryFn: async () => {
      const { organization } = await gqlRequest(LabelManagementQuery);
      const role = (organization.securitySettings as { labelManagementRole?: unknown })
        .labelManagementRole;
      return typeof role === 'string' ? role : undefined;
    },
  });
  return canManageLabels(workspaceRole, settings.data);
}
