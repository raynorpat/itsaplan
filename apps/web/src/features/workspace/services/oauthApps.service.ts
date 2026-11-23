'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { instanceFetch } from '@/lib/auth-client';
import { qk } from '@/services/queryKeys';
import type { OAuthAppInput } from '../utils/oauthAppForm';

// The workspace's OAuth applications (Linear's OAuth applications), managed by its
// admins and owners through /api/auth/instance/oauth-apps*. Secrets are only in the
// answers of create and the rotations.

export interface OAuthAppInstallation {
  appUserId: string;
  publicTeams: boolean;
  teamIds: string[];
  scopes: string[];
  installedAt: string;
}

export interface OAuthApp {
  clientId: string;
  name: string;
  description: string | null;
  developer: string | null;
  developerUrl: string | null;
  iconUrl: string | null;
  redirectUris: string[];
  publicClient: boolean;
  clientCredentials: boolean;
  webhookUrl: string | null;
  webhookResourceTypes: string[];
  archived: boolean;
  createdAt: string;
  installation: OAuthAppInstallation | null;
}

// The secrets an answer carries: shown once, never stored by the web app.
export interface OAuthAppSecrets {
  clientSecret?: string;
  webhookSecret?: string;
}

export function useOAuthAppsQuery(enabled: boolean) {
  return useQuery({
    queryKey: qk.oauthApps,
    queryFn: async () =>
      (await instanceFetch<{ applications: OAuthApp[] }>('/instance/oauth-apps')).applications,
    enabled,
  });
}

function useAppWrite<TInput, TResult>(path: string, toBody: (input: TInput) => object) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: TInput) =>
      instanceFetch<TResult>(path, {
        method: 'POST',
        body: toBody(input) as Record<string, unknown>,
      }),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.oauthApps }),
  });
}

export const useCreateOAuthApp = () =>
  useAppWrite<OAuthAppInput, { application: OAuthApp } & OAuthAppSecrets>(
    '/instance/oauth-apps/create',
    (input) => input,
  );

// The client type cannot change after creation, so an update leaves it out.
export const useUpdateOAuthApp = () =>
  useAppWrite<
    { clientId: string; input: OAuthAppInput },
    { application: OAuthApp } & OAuthAppSecrets
  >('/instance/oauth-apps/update', ({ clientId, input }) => {
    const { publicClient: _publicClient, ...rest } = input;
    return { clientId, ...rest };
  });

export const useRotateOAuthAppSecret = () =>
  useAppWrite<string, { clientSecret: string }>(
    '/instance/oauth-apps/rotate-secret',
    (clientId) => ({
      clientId,
    }),
  );

export const useRotateOAuthAppWebhookSecret = () =>
  useAppWrite<string, { webhookSecret: string }>(
    '/instance/oauth-apps/rotate-webhook-secret',
    (clientId) => ({ clientId }),
  );

export const useArchiveOAuthApp = () =>
  useAppWrite<string, { success: boolean }>('/instance/oauth-apps/archive', (clientId) => ({
    clientId,
  }));

// Uninstalls an application: every token of it stops working and its app user is
// suspended.
export const useUninstallOAuthApp = () =>
  useAppWrite<string, { success: boolean }>('/instance/oauth-uninstall', (clientId) => ({
    clientId,
  }));
