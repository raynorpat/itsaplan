import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type NewCredentialInput, type CredentialPatch } from '@/lib/api';
import { qk } from '@/services/queryKeys';

export function useCredentialsQuery(teamKey: string | null) {
  return useQuery({
    queryKey: qk.integrationCredentials(teamKey ?? ''),
    queryFn: () => api.listCredentials(teamKey!),
    enabled: teamKey != null,
  });
}

// The integrations the instance offers. Changes only on deploy, so it is cached
// for the session.
export function useIntegrationCatalogQuery(teamKey: string | null) {
  return useQuery({
    queryKey: qk.integrationCatalog(teamKey ?? ''),
    queryFn: () => api.listIntegrationCatalog(teamKey!),
    enabled: teamKey != null,
    staleTime: Infinity,
  });
}

// Models an LLM provider offers (from the models.dev registry). Fetched only when a
// provider is chosen; cached for the session.
export function useIntegrationModelsQuery(teamKey: string | null, provider: string | null) {
  return useQuery({
    queryKey: qk.integrationModels(teamKey ?? '', provider ?? ''),
    queryFn: () => api.listIntegrationModels(teamKey!, provider!),
    enabled: teamKey != null && provider != null && provider.length > 0,
    staleTime: Infinity,
  });
}

export function useCreateCredential(teamKey: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NewCredentialInput) => api.createCredential(teamKey!, input),
    onSuccess: () => {
      if (teamKey) void qc.invalidateQueries({ queryKey: qk.integrationCredentials(teamKey) });
    },
  });
}

export function useUpdateCredential(teamKey: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: CredentialPatch }) =>
      api.updateCredential(teamKey!, id, patch),
    onSuccess: () => {
      if (teamKey) void qc.invalidateQueries({ queryKey: qk.integrationCredentials(teamKey) });
    },
  });
}

export function useDeleteCredential(teamKey: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteCredential(teamKey!, id),
    onSuccess: () => {
      if (teamKey) void qc.invalidateQueries({ queryKey: qk.integrationCredentials(teamKey) });
    },
  });
}
