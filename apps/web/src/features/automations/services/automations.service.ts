'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { instanceFetch } from '@/lib/auth-client';
import { qk } from '@/services/queryKeys';
import type { WorkflowRule } from '../utils/rules';

// A team's automation rules (Linear's WorkflowDefinition), managed through the
// instance plugin's /api/auth/instance/workflows* endpoints. The list holds archived
// rules too; the page splits them.

export function useAutomationsQuery(teamId: string | null) {
  return useQuery({
    queryKey: qk.automations(teamId ?? ''),
    queryFn: async () =>
      (
        await instanceFetch<{ workflows: WorkflowRule[] }>(
          `/instance/workflows?teamId=${encodeURIComponent(teamId!)}&includeArchived=true`,
        )
      ).workflows,
    enabled: teamId != null,
  });
}

// One write to a rule. `optimistic` changes the cached list before the request; a
// failure restores it and shows the API's message.
function useRuleWrite<TInput>(
  teamId: string,
  path: string,
  toBody: (input: TInput) => Record<string, unknown>,
  optimistic?: (rules: WorkflowRule[], input: TInput) => WorkflowRule[],
) {
  const qc = useQueryClient();
  const key = qk.automations(teamId);
  return useMutation({
    mutationFn: (input: TInput) => instanceFetch(path, { method: 'POST', body: toBody(input) }),
    onMutate: async (input: TInput) => {
      if (!optimistic) return { previous: undefined };
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<WorkflowRule[]>(key);
      if (previous) qc.setQueryData(key, optimistic(previous, input));
      return { previous };
    },
    onError: (err, _input, context) => {
      if (context?.previous) qc.setQueryData(key, context.previous);
      toast.error(err instanceof Error ? err.message : 'The change failed');
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });
}

const patchRule = (rules: WorkflowRule[], id: string, patch: Partial<WorkflowRule>) =>
  rules.map((r) => (r.id === id ? { ...r, ...patch } : r));

export const useEnableAutomation = (teamId: string) =>
  useRuleWrite<{ id: string; enabled: boolean }>(
    teamId,
    '/instance/workflows/enable',
    (input) => input,
    (rules, { id, enabled }) => patchRule(rules, id, { enabled }),
  );

export const useReorderAutomation = (teamId: string) =>
  useRuleWrite<{ id: string; sortOrder: number }>(
    teamId,
    '/instance/workflows/reorder',
    (input) => input,
    (rules, { id, sortOrder }) =>
      patchRule(rules, id, { sortOrder }).sort((a, b) => a.sortOrder - b.sortOrder),
  );

export const useArchiveAutomation = (teamId: string) =>
  useRuleWrite<string>(
    teamId,
    '/instance/workflows/archive',
    (id) => ({ id }),
    (rules, id) => patchRule(rules, id, { archivedAt: new Date().toISOString() }),
  );

export const useUnarchiveAutomation = (teamId: string) =>
  useRuleWrite<string>(
    teamId,
    '/instance/workflows/unarchive',
    (id) => ({ id }),
    (rules, id) => patchRule(rules, id, { archivedAt: null }),
  );

export const useDeleteAutomation = (teamId: string) =>
  useRuleWrite<string>(
    teamId,
    '/instance/workflows/delete',
    (id) => ({ id }),
    (rules, id) => rules.filter((r) => r.id !== id),
  );
