import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Permissions } from '@/lib/api';
import { qk } from '@/services/queryKeys';

// The resources and actions of the permission matrix. Static for the app's
// lifetime, so it never goes stale.
export function usePermissionCatalogQuery() {
  return useQuery({
    queryKey: qk.permissionCatalog,
    queryFn: () => api.getPermissionCatalog(),
    staleTime: Infinity,
  });
}

// Roles are listable by any member, but only owners have a use for them here.
// Pass enabled=false for a non-owner to skip the request.
export function useRolesQuery(teamKey: string | null, enabled = true) {
  return useQuery({
    queryKey: qk.roles(teamKey ?? ''),
    queryFn: () => api.listRoles(teamKey!),
    enabled: teamKey != null && enabled,
  });
}

export function useCreateRole(teamKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; permissions: Permissions }) =>
      api.createRole(teamKey, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.roles(teamKey) }),
  });
}

export function useUpdateRole(teamKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      roleId,
      patch,
    }: {
      roleId: string;
      patch: { name?: string; permissions?: Permissions };
    }) => api.updateRole(teamKey, roleId, patch),
    // A rename changes the role name shown on members, so refresh both lists.
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.roles(teamKey) });
      qc.invalidateQueries({ queryKey: qk.members(teamKey) });
    },
  });
}

export function useDeleteRole(teamKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (roleId: string) => api.deleteRole(teamKey, roleId),
    // Deleting a role reassigns its members to the default role.
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.roles(teamKey) });
      qc.invalidateQueries({ queryKey: qk.members(teamKey) });
    },
  });
}
