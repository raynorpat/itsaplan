import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, type OrganizationSettingsPatch } from '@/lib/api';
import { qk } from '@/services/queryKeys';

// The workspace settings (Linear's Organization): read by any signed-in user,
// changed by owners and admins.
export function useOrganizationQuery() {
  return useQuery({ queryKey: qk.organization, queryFn: () => api.getOrganization() });
}

export function useUpdateOrganization() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: OrganizationSettingsPatch) => api.updateOrganization(patch),
    onSuccess: (data) => {
      qc.setQueryData(qk.organization, data);
      toast.success('Workspace settings saved');
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Could not save'),
  });
}
