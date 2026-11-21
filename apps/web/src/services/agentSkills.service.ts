import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type NewSkillInput, type SkillPatch } from '@/lib/api';
import { qk } from '@/services/queryKeys';

export function useSkillsQuery(teamKey: string | null) {
  return useQuery({
    queryKey: qk.agentSkills(teamKey ?? ''),
    queryFn: () => api.listSkills(teamKey!),
    enabled: teamKey != null,
  });
}

export function useCreateSkill(teamKey: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NewSkillInput) => api.createSkill(teamKey!, input),
    onSuccess: () => {
      if (teamKey) void qc.invalidateQueries({ queryKey: qk.agentSkills(teamKey) });
    },
  });
}

// Lists the skills at a GitHub URL so the user can pick which to import. Read-only:
// no cache invalidation.
export function useDiscoverGithubSkills(teamKey: string | null) {
  return useMutation({
    mutationFn: (url: string) => api.discoverGithubSkills(teamKey!, url),
  });
}

export function useUpdateSkill(teamKey: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: SkillPatch }) =>
      api.updateSkill(teamKey!, id, patch),
    onSuccess: () => {
      if (teamKey) void qc.invalidateQueries({ queryKey: qk.agentSkills(teamKey) });
    },
  });
}

export function useDeleteSkill(teamKey: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteSkill(teamKey!, id),
    onSuccess: () => {
      if (teamKey) void qc.invalidateQueries({ queryKey: qk.agentSkills(teamKey) });
    },
  });
}

export function useAddSkillReference(teamKey: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, file }: { id: string; file: File }) =>
      api.addSkillReference(teamKey!, id, file),
    onSuccess: () => {
      if (teamKey) void qc.invalidateQueries({ queryKey: qk.agentSkills(teamKey) });
    },
  });
}

export function useUpdateSkillReference(teamKey: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, path, content }: { id: string; path: string; content: string }) =>
      api.updateSkillReferenceContent(teamKey!, id, path, content),
    onSuccess: () => {
      if (teamKey) void qc.invalidateQueries({ queryKey: qk.agentSkills(teamKey) });
    },
  });
}

export function useDeleteSkillReference(teamKey: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, path }: { id: string; path: string }) =>
      api.deleteSkillReference(teamKey!, id, path),
    onSuccess: () => {
      if (teamKey) void qc.invalidateQueries({ queryKey: qk.agentSkills(teamKey) });
    },
  });
}

// The skills enabled on one agent (the agent editor's Skills tab).
export function useAgentSkillsQuery(teamKey: string | null, agentId: string | null) {
  return useQuery({
    queryKey: qk.agentSkillLinks(teamKey ?? '', agentId ?? ''),
    queryFn: () => api.listAgentSkills(teamKey!, agentId!),
    enabled: teamKey != null && agentId != null,
  });
}

export function useSetAgentSkills(teamKey: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, skillIds }: { agentId: string; skillIds: string[] }) =>
      api.setAgentSkills(teamKey!, agentId, skillIds),
    onSuccess: (_data, { agentId }) => {
      if (teamKey) void qc.invalidateQueries({ queryKey: qk.agentSkillLinks(teamKey, agentId) });
    },
  });
}
