import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { qk } from '@/services/queryKeys';

export function useCustomFieldsQuery(teamKey: string | null, typeId?: string | null) {
  return useQuery({
    queryKey: qk.customFields(teamKey ?? '', typeId),
    queryFn: () => api.listCustomFields(teamKey!, typeId ?? undefined),
    enabled: teamKey != null,
  });
}
