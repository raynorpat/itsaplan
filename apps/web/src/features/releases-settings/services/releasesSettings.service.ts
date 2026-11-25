import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { instanceFetch } from '@/lib/auth-client';
import { graphql, gqlRequest } from '@/lib/graphql';
import { qk } from '@/services/queryKeys';
import type { ReleaseStageLike } from '@/utils/releases';

// Team settings → Releases: a team's pipelines with their settings and stages, the
// pipeline and stage writes (Linear's releasePipeline* / releaseStage* mutations), and
// the pipeline access keys (the instance plugin's /instance/access-keys*, since
// Linear's schema has no mutation for them).

export interface PipelineSettings {
  id: string;
  slugId: string;
  name: string;
  type: 'continuous' | 'scheduled';
  isProduction: boolean;
  rolloverIssuesOnCompletion: boolean;
  autoGenerateReleaseNotesOnCompletion: boolean;
  includePathPatterns: string[];
  teams: { id: string; key: string; name: string }[];
  stages: ReleaseStageLike[];
}

export interface AccessKey {
  id: string;
  createdAt: string;
  lastUsedAt: string | null;
  creator: { id: string; name: string } | null;
}

const PipelinesSettingsQuery = graphql(`
  query ReleasePipelinesSettings($filter: ReleasePipelineFilter) {
    releasePipelines(filter: $filter, first: 100) {
      nodes {
        id
        slugId
        name
        type
        isProduction
        rolloverIssuesOnCompletion
        autoGenerateReleaseNotesOnCompletion
        includePathPatterns
        teams(first: 50) {
          nodes {
            id
            key
            name
          }
        }
        stages(first: 50) {
          nodes {
            id
            name
            type
            color
            position
            frozen
          }
        }
      }
    }
  }
`);

const settingsKey = (teamId: string) => [...qk.releasePipelines(teamId), 'settings'] as const;

export function usePipelineSettings(teamId: string | null) {
  return useQuery({
    queryKey: settingsKey(teamId ?? ''),
    queryFn: async (): Promise<PipelineSettings[]> => {
      const data = await gqlRequest(PipelinesSettingsQuery, {
        filter: { teams: { some: { id: { eq: teamId } } } },
      });
      return data.releasePipelines.nodes.map((p) => ({
        id: p.id,
        slugId: p.slugId,
        name: p.name,
        type: p.type === 'scheduled' ? 'scheduled' : 'continuous',
        isProduction: p.isProduction,
        rolloverIssuesOnCompletion: p.rolloverIssuesOnCompletion,
        autoGenerateReleaseNotesOnCompletion: p.autoGenerateReleaseNotesOnCompletion,
        includePathPatterns: p.includePathPatterns,
        teams: p.teams.nodes,
        stages: p.stages.nodes,
      }));
    },
    enabled: teamId != null,
  });
}

const PipelineCreate = graphql(`
  mutation ReleasePipelineCreate($input: ReleasePipelineCreateInput!) {
    releasePipelineCreate(input: $input) {
      success
    }
  }
`);

const PipelineUpdate = graphql(`
  mutation ReleasePipelineUpdate($id: String!, $input: ReleasePipelineUpdateInput!) {
    releasePipelineUpdate(id: $id, input: $input) {
      success
    }
  }
`);

const PipelineArchive = graphql(`
  mutation ReleasePipelineArchive($id: String!) {
    releasePipelineArchive(id: $id) {
      success
    }
  }
`);

const StageCreate = graphql(`
  mutation ReleaseStageCreate($input: ReleaseStageCreateInput!) {
    releaseStageCreate(input: $input) {
      success
    }
  }
`);

const StageUpdate = graphql(`
  mutation ReleaseStageUpdate($id: String!, $input: ReleaseStageUpdateInput!) {
    releaseStageUpdate(id: $id, input: $input) {
      success
    }
  }
`);

const StageArchive = graphql(`
  mutation ReleaseStageArchive($id: String!) {
    releaseStageArchive(id: $id) {
      success
    }
  }
`);

export interface PipelineInput {
  name: string;
  type: 'continuous' | 'scheduled';
  isProduction: boolean;
  rolloverIssuesOnCompletion: boolean;
  autoGenerateReleaseNotesOnCompletion: boolean;
  includePathPatterns: string[];
}

export interface StageInput {
  name?: string;
  color?: string;
  position?: number;
  frozen?: boolean;
}

const onError = (err: Error) => toast.error(err.message);

// Pipeline and stage writes. Each refetches every pipeline and release query, so the
// release pages follow a renamed stage or pipeline.
export function usePipelineSettingsWrites() {
  const qc = useQueryClient();
  const onSettled = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: qk.anyReleasePipelines }),
      qc.invalidateQueries({ queryKey: qk.anyReleases }),
    ]);
  const createPipeline = useMutation({
    mutationFn: (input: PipelineInput & { teamIds: string[] }) =>
      gqlRequest(PipelineCreate, { input }),
    onSettled,
    onError,
  });
  const updatePipeline = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<PipelineInput> }) =>
      gqlRequest(PipelineUpdate, { id, input }),
    onSettled,
    onError,
  });
  const archivePipeline = useMutation({
    mutationFn: (id: string) => gqlRequest(PipelineArchive, { id }),
    onSettled,
    onError,
  });
  const createStage = useMutation({
    mutationFn: (input: { pipelineId: string; name: string; color: string; position: number }) =>
      gqlRequest(StageCreate, { input: { ...input, type: 'started' } }),
    onSettled,
    onError,
  });
  const updateStage = useMutation({
    mutationFn: ({ id, input }: { id: string; input: StageInput }) =>
      gqlRequest(StageUpdate, { id, input }),
    onSettled,
    onError,
  });
  const archiveStage = useMutation({
    mutationFn: (id: string) => gqlRequest(StageArchive, { id }),
    onSettled,
    onError,
  });
  return {
    createPipeline,
    updatePipeline,
    archivePipeline,
    createStage,
    updateStage,
    archiveStage,
  };
}

const keysKey = (pipelineId: string) => ['releaseAccessKeys', pipelineId] as const;

export function useAccessKeys(pipelineId: string) {
  return useQuery({
    queryKey: keysKey(pipelineId),
    queryFn: async () =>
      (
        await instanceFetch<{ accessKeys: AccessKey[] }>(
          `/instance/access-keys?pipelineId=${encodeURIComponent(pipelineId)}`,
        )
      ).accessKeys,
  });
}

// Creating returns the key, shown once; revoking stops it at once.
export function useAccessKeyWrites(pipelineId: string) {
  const qc = useQueryClient();
  const onSettled = () => qc.invalidateQueries({ queryKey: keysKey(pipelineId) });
  const create = useMutation({
    mutationFn: async () =>
      (
        await instanceFetch<{ key: string }>('/instance/access-keys/create', {
          method: 'POST',
          body: { pipelineId },
        })
      ).key,
    onSettled,
    onError,
  });
  const revoke = useMutation({
    mutationFn: (id: string) =>
      instanceFetch('/instance/access-keys/revoke', { method: 'POST', body: { id } }),
    onSettled,
    onError,
  });
  return { create, revoke };
}
