'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { instanceFetch } from '@/lib/auth-client';
import { graphql, gqlRequest } from '@/lib/graphql';
import { qk } from '@/services/queryKeys';
import { normalizeRule, type WorkflowRule } from '../utils/rules';

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
      ).workflows.map(normalizeRule),
    enabled: teamId != null,
  });
}

// One rule, for the editor. A rule the viewer cannot see is a 404 from the API.
export function useAutomationQuery(id: string | null) {
  return useQuery({
    queryKey: qk.automation(id ?? ''),
    queryFn: async () =>
      normalizeRule(
        (
          await instanceFetch<{ workflow: WorkflowRule }>(
            `/instance/workflow?id=${encodeURIComponent(id!)}`,
          )
        ).workflow,
      ),
    enabled: id != null,
  });
}

const CycleLookup = graphql(`
  query AutomationCycle($id: String!) {
    cycle(id: $id) {
      id
      name
      number
      archivedAt
    }
  }
`);

// A cycle an action points at that the team data does not list (a completed one). An
// archived cycle counts as gone: the API refuses to set it.
export function useAutomationCycleQuery(id: string | null) {
  return useQuery({
    queryKey: qk.automationCycle(id ?? ''),
    queryFn: async () => {
      const { cycle } = await gqlRequest(CycleLookup, { id: id! });
      return cycle.archivedAt
        ? null
        : { id: cycle.id, name: cycle.name ?? null, number: cycle.number };
    },
    enabled: id != null,
    retry: false,
  });
}

// Creates a rule (`id` null) or changes one. Errors are left to the caller, which
// shows the API's message next to the form.
export function useSaveAutomation(teamId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string | null; input: Record<string, unknown> }) =>
      instanceFetch<{ workflow: WorkflowRule }>(
        id ? '/instance/workflows/update' : '/instance/workflows/create',
        { method: 'POST', body: id ? { ...input, id } : input },
      ),
    onSuccess: ({ workflow }) => {
      qc.setQueryData(qk.automation(workflow.id), normalizeRule(workflow));
      return qc.invalidateQueries({ queryKey: qk.automations(teamId) });
    },
  });
}

// One write to a rule. `optimistic` changes the cached list before the request; a
// failure restores it and shows the API's message.
function useRuleWrite<TInput extends string | { id: string }>(
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
    onSettled: (_data, error, input) => {
      // The editor reads the rule through its own query; a deleted rule's entry is
      // dropped so the editor does not keep showing it from the cache.
      const id = typeof input === 'string' ? input : input.id;
      if (path === '/instance/workflows/delete' && !error)
        qc.removeQueries({ queryKey: qk.automation(id) });
      else void qc.invalidateQueries({ queryKey: qk.automation(id) });
      return qc.invalidateQueries({ queryKey: key });
    },
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
