'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { instanceFetch } from '@/lib/auth-client';
import { qk } from '@/services/queryKeys';

// The OpenAI-compatible endpoint that writes requester summaries, through the instance
// plugin (/api/auth/instance/ai*, owners and admins); Linear's schema has no setting
// for it. The API never returns the key, only whether one is stored.

export interface AiSettings {
  baseUrl: string | null;
  model: string | null;
  hasKey: boolean;
}

export function useAiSettingsQuery(enabled: boolean) {
  return useQuery({
    queryKey: qk.aiSettings,
    queryFn: () => instanceFetch<AiSettings>('/instance/ai'),
    enabled,
  });
}

function useAiWrite<TInput extends Record<string, unknown>, TResult>(
  path: string,
  refresh: boolean,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: TInput) => instanceFetch<TResult>(path, { method: 'POST', body: input }),
    onSuccess: (data) => {
      if (refresh) qc.setQueryData(qk.aiSettings, data);
    },
  });
}

// An empty key keeps the stored one.
export const useSaveAiSettings = () =>
  useAiWrite<{ baseUrl: string; model: string; apiKey: string }, AiSettings>(
    '/instance/ai/save',
    true,
  );

export const useDeleteAiSettings = () =>
  useAiWrite<Record<string, never>, AiSettings>('/instance/ai/delete', true);

export const useTestAiSettings = () =>
  useAiWrite<Record<string, never>, { ok: boolean; error?: string }>('/instance/ai/test', false);
