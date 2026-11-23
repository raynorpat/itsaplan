'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { instanceFetch } from '@/lib/auth-client';
import { qk } from '@/services/queryKeys';

// The applications the signed-in person has authorized to act as themselves
// (/api/auth/instance/oauth-authorized). An app installed with actor=app is the
// workspace's and is managed by its admins, so it is not listed.
export interface AuthorizedApp {
  clientId: string;
  name: string;
  iconUrl: string | null;
  developer: string | null;
  scopes: string[];
  authorizedAt: string;
}

export function useAuthorizedAppsQuery() {
  return useQuery({
    queryKey: qk.oauthAuthorized,
    queryFn: async () =>
      (await instanceFetch<{ applications: AuthorizedApp[] }>('/instance/oauth-authorized'))
        .applications,
  });
}

// Revokes one: the person's consent and tokens for the application.
export function useRevokeAuthorizedApp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (clientId: string) =>
      instanceFetch('/instance/oauth-authorized/revoke', { method: 'POST', body: { clientId } }),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.oauthAuthorized }),
  });
}
