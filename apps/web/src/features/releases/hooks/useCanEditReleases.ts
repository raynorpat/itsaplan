import { usePermissions } from '@/hooks/usePermissions';

// Whether the viewer may change releases: owners, admins and members who see one of a
// pipeline's teams (the API's rule); guests read only.
export function useCanEditReleases(): boolean {
  const { workspaceRole } = usePermissions();
  return workspaceRole != null && workspaceRole !== 'guest';
}
