import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { instanceFetch } from '@/lib/auth-client';
import { graphql, gqlRequest, readFragment, type FragmentOf } from '@/lib/graphql';
import { qk } from '@/services/queryKeys';
import type { ReleaseStageLike } from '@/utils/releases';

// Release tracking (Linear's ReleasePipeline, ReleaseStage, Release, ReleaseNote): the
// pipelines of a team, one pipeline with its releases, one release, and the writes the
// release pages and the issue's Release property make.

export type ReleaseStage = ReleaseStageLike;

export interface ReleaseListItem {
  id: string;
  slugId: string;
  name: string;
  version: string | null;
  stage: ReleaseStage;
  issueCount: number;
  startDate: string | null;
  targetDate: string | null;
  completedAt: string | null;
  canceledAt: string | null;
  createdAt: string;
}

export interface PipelineSummary {
  id: string;
  slugId: string;
  name: string;
  type: 'continuous' | 'scheduled';
  isProduction: boolean;
  approximateReleaseCount: number;
  stages: ReleaseStage[];
  latestRelease: ReleaseListItem | null;
}

export interface Pipeline extends PipelineSummary {
  // The newest PIPELINE_RELEASE_LIMIT releases; `releasesCapped` when there are more.
  releases: ReleaseListItem[];
  releasesCapped: boolean;
}

export const PIPELINE_RELEASE_LIMIT = 250;

export interface ReleaseIssueRow {
  id: string;
  identifier: string;
  title: string;
  teamKey: string;
  number: number;
  state: { name: string; type: string; color: string };
}

export interface ReleaseNote {
  id: string;
  title: string | null;
  content: string;
}

export interface ReleaseDetail extends ReleaseListItem {
  description: string | null;
  commitSha: string | null;
  startedAt: string | null;
  url: string;
  pipeline: {
    id: string;
    slugId: string;
    name: string;
    type: 'continuous' | 'scheduled';
    stages: ReleaseStage[];
  };
  issues: ReleaseIssueRow[];
  links: { id: string; url: string; label: string | null }[];
  documents: { id: string; title: string; content: string }[];
  progress: { completed: number; total: number };
  notes: ReleaseNote[];
}

const StageFields = graphql(`
  fragment ReleaseStageFields on ReleaseStage {
    id
    name
    type
    color
    position
    frozen
  }
`);

const ReleaseListFields = graphql(
  `
    fragment ReleaseListFields on Release {
      id
      slugId
      name
      version
      issueCount
      startDate
      targetDate
      completedAt
      canceledAt
      createdAt
      stage {
        ...ReleaseStageFields
      }
    }
  `,
  [StageFields],
);

const PipelineFields = graphql(
  `
    fragment PipelineFields on ReleasePipeline {
      id
      slugId
      name
      type
      isProduction
      approximateReleaseCount
      stages(first: 50) {
        nodes {
          ...ReleaseStageFields
        }
      }
      latest: releases(first: 1) {
        nodes {
          ...ReleaseListFields
        }
      }
    }
  `,
  [StageFields, ReleaseListFields],
);

const TeamPipelinesQuery = graphql(
  `
    query TeamReleasePipelines($filter: ReleasePipelineFilter) {
      releasePipelines(filter: $filter, first: 100) {
        nodes {
          ...PipelineFields
        }
      }
    }
  `,
  [PipelineFields],
);

const PipelineQuery = graphql(
  `
    query ReleasePipelinePage($id: String!) {
      releasePipeline(id: $id) {
        ...PipelineFields
        releases(first: 250) {
          nodes {
            ...ReleaseListFields
          }
          pageInfo {
            hasNextPage
          }
        }
      }
    }
  `,
  [PipelineFields, ReleaseListFields],
);

const ReleaseQuery = graphql(
  `
    query ReleasePage($id: String!) {
      release(id: $id) {
        ...ReleaseListFields
        description
        commitSha
        startedAt
        url
        currentProgress
        pipeline {
          id
          slugId
          name
          type
          stages(first: 50) {
            nodes {
              ...ReleaseStageFields
            }
          }
        }
        issues(first: 250) {
          nodes {
            id
            identifier
            title
            number
            team {
              key
            }
            state {
              name
              type
              color
            }
          }
        }
        links(first: 100) {
          nodes {
            id
            url
            label
          }
        }
        documents(first: 50) {
          nodes {
            id
            title
            content
          }
        }
        releaseNotes {
          id
          title
          documentContent {
            content
          }
        }
      }
    }
  `,
  [ReleaseListFields, StageFields],
);

const toStage = (data: FragmentOf<typeof StageFields>): ReleaseStage => {
  const s = readFragment(StageFields, data);
  return {
    id: s.id,
    name: s.name,
    type: s.type,
    color: s.color,
    position: s.position,
    frozen: s.frozen,
  };
};

const optionalDate = (v: unknown): string | null => (v == null ? null : String(v));

function toReleaseListItem(data: FragmentOf<typeof ReleaseListFields>): ReleaseListItem {
  const r = readFragment(ReleaseListFields, data);
  return {
    id: r.id,
    slugId: r.slugId,
    name: r.name,
    version: r.version ?? null,
    stage: toStage(r.stage),
    issueCount: r.issueCount,
    startDate: optionalDate(r.startDate),
    targetDate: optionalDate(r.targetDate),
    completedAt: optionalDate(r.completedAt),
    canceledAt: optionalDate(r.canceledAt),
    createdAt: String(r.createdAt),
  };
}

function toPipelineSummary(data: FragmentOf<typeof PipelineFields>): PipelineSummary {
  const p = readFragment(PipelineFields, data);
  const latest = p.latest.nodes[0];
  return {
    id: p.id,
    slugId: p.slugId,
    name: p.name,
    type: p.type === 'scheduled' ? 'scheduled' : 'continuous',
    isProduction: p.isProduction,
    approximateReleaseCount: p.approximateReleaseCount,
    stages: p.stages.nodes.map(toStage),
    latestRelease: latest ? toReleaseListItem(latest) : null,
  };
}

// Completed and total issue counts from Linear's `currentProgress` JSON.
function progressOf(raw: unknown): { completed: number; total: number } {
  const p = (raw ?? {}) as { issueCount?: unknown; completedIssueCount?: unknown };
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return { completed: num(p.completedIssueCount), total: num(p.issueCount) };
}

// The release pipelines of a team.
export function useTeamPipelines(teamId: string | null) {
  return useQuery({
    queryKey: qk.releasePipelines(teamId ?? ''),
    queryFn: async () => {
      const data = await gqlRequest(TeamPipelinesQuery, {
        filter: { teams: { some: { id: { eq: teamId } } } },
      });
      return data.releasePipelines.nodes.map(toPipelineSummary);
    },
    enabled: teamId != null,
  });
}

// One pipeline, by id or slug, with its releases newest first.
export function usePipeline(idOrSlug: string | null) {
  return useQuery({
    queryKey: qk.releasePipeline(idOrSlug ?? ''),
    queryFn: async (): Promise<Pipeline | null> => {
      const data = await gqlRequest(PipelineQuery, { id: idOrSlug! });
      const p = data.releasePipeline;
      return {
        ...toPipelineSummary(p),
        releases: p.releases.nodes.map(toReleaseListItem),
        releasesCapped: p.releases.pageInfo.hasNextPage,
      };
    },
    enabled: idOrSlug != null,
    retry: false,
  });
}

// One release, by id or slug.
export function useRelease(idOrSlug: string | null) {
  return useQuery({
    queryKey: qk.release(idOrSlug ?? ''),
    queryFn: async (): Promise<ReleaseDetail> => {
      const data = await gqlRequest(ReleaseQuery, { id: idOrSlug! });
      const r = data.release;
      return {
        ...toReleaseListItem(r),
        description: r.description ?? null,
        commitSha: r.commitSha ?? null,
        startedAt: optionalDate(r.startedAt),
        url: r.url,
        pipeline: {
          id: r.pipeline.id,
          slugId: r.pipeline.slugId,
          name: r.pipeline.name,
          type: r.pipeline.type === 'scheduled' ? 'scheduled' : 'continuous',
          stages: r.pipeline.stages.nodes.map(toStage),
        },
        issues: r.issues.nodes.map((i) => ({
          id: i.id,
          identifier: i.identifier,
          title: i.title,
          number: i.number,
          teamKey: i.team.key,
          state: { name: i.state.name, type: i.state.type, color: i.state.color },
        })),
        links: r.links.nodes.map((l) => ({ id: l.id, url: l.url, label: l.label ?? null })),
        documents: r.documents.nodes.map((d) => ({
          id: d.id,
          title: d.title,
          content: d.content ?? '',
        })),
        progress: progressOf(r.currentProgress),
        notes: r.releaseNotes.map((n) => ({
          id: n.id,
          title: n.title ?? null,
          content: n.documentContent?.content ?? '',
        })),
      };
    },
    enabled: idOrSlug != null,
    retry: false,
  });
}

const ReleaseCreate = graphql(`
  mutation ReleaseCreate($input: ReleaseCreateInput!) {
    releaseCreate(input: $input) {
      release {
        id
        slugId
      }
    }
  }
`);

const ReleaseUpdate = graphql(`
  mutation ReleaseUpdate($id: String!, $input: ReleaseUpdateInput!) {
    releaseUpdate(id: $id, input: $input) {
      success
    }
  }
`);

const ReleaseArchive = graphql(`
  mutation ReleaseArchive($id: String!) {
    releaseArchive(id: $id) {
      success
    }
  }
`);

const IssueToReleaseCreate = graphql(`
  mutation IssueToReleaseCreate($input: IssueToReleaseCreateInput!) {
    issueToReleaseCreate(input: $input) {
      success
    }
  }
`);

const IssueToReleaseDelete = graphql(`
  mutation IssueToReleaseDeleteByIssueAndRelease($issueId: String!, $releaseId: String!) {
    issueToReleaseDeleteByIssueAndRelease(issueId: $issueId, releaseId: $releaseId) {
      success
    }
  }
`);

export interface ReleaseUpdateInput {
  name?: string;
  version?: string | null;
  description?: string | null;
  stageId?: string;
  startDate?: string | null;
  targetDate?: string | null;
}

// Every release write refetches the release pages and issues' Release property.
function useInvalidateReleases() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: qk.anyReleases }),
      qc.invalidateQueries({ queryKey: qk.anyReleasePipelines }),
      qc.invalidateQueries({ queryKey: qk.anyIssueReleases }),
      qc.invalidateQueries({ queryKey: qk.anyIssueOrderRanks }),
    ]);
}

const onError = (err: Error) => toast.error(err.message);

// Release writes: create, update (fields and stage: moving to the completed stage
// completes the release, with rollover and the automatic note, as releaseComplete
// does), archive, and adding or removing an issue.
export function useReleaseWrites() {
  const invalidate = useInvalidateReleases();
  const create = useMutation({
    mutationFn: async (input: { pipelineId: string; name: string; targetDate?: string | null }) =>
      (await gqlRequest(ReleaseCreate, { input })).releaseCreate.release,
    onSettled: invalidate,
    onError,
  });
  const update = useMutation({
    mutationFn: ({ id, input }: { id: string; input: ReleaseUpdateInput }) =>
      gqlRequest(ReleaseUpdate, { id, input }),
    onSettled: invalidate,
    onError,
  });
  const archive = useMutation({
    mutationFn: (id: string) => gqlRequest(ReleaseArchive, { id }),
    onSettled: invalidate,
    onError,
  });
  const addIssue = useMutation({
    mutationFn: (input: { issueId: string; releaseId: string }) =>
      gqlRequest(IssueToReleaseCreate, { input }),
    onSettled: invalidate,
    onError,
  });
  const removeIssue = useMutation({
    mutationFn: (args: { issueId: string; releaseId: string }) =>
      gqlRequest(IssueToReleaseDelete, args),
    onSettled: invalidate,
    onError,
  });
  return { create, update, archive, addIssue, removeIssue };
}

const NoteCreate = graphql(`
  mutation ReleaseNoteCreate($input: ReleaseNoteCreateInput!) {
    releaseNoteCreate(input: $input) {
      success
    }
  }
`);

const NoteUpdate = graphql(`
  mutation ReleaseNoteUpdate($id: String!, $input: ReleaseNoteUpdateInput!) {
    releaseNoteUpdate(id: $id, input: $input) {
      success
    }
  }
`);

const NoteDelete = graphql(`
  mutation ReleaseNoteDelete($id: String!) {
    releaseNoteDelete(id: $id) {
      success
    }
  }
`);

// The "Fill from issues" draft: the release's completed issues as Markdown, grouped by
// label (Linear's schema has no query for it).
export const fetchNoteDraft = (releaseId: string) =>
  instanceFetch<{ title: string; content: string }>(
    `/instance/releases/note-draft?releaseId=${encodeURIComponent(releaseId)}`,
  );

// Release note writes: create for one release, update the text, delete.
export function useReleaseNoteWrites() {
  const invalidate = useInvalidateReleases();
  const create = useMutation({
    mutationFn: (input: {
      pipelineId: string;
      releaseId: string;
      content: string;
      title?: string;
    }) =>
      gqlRequest(NoteCreate, {
        input: {
          pipelineId: input.pipelineId,
          releaseIds: [input.releaseId],
          content: input.content,
          ...(input.title ? { title: input.title } : {}),
        },
      }),
    onSettled: invalidate,
    onError,
  });
  const update = useMutation({
    mutationFn: ({ id, content }: { id: string; content: string }) =>
      gqlRequest(NoteUpdate, { id, input: { content } }),
    onSettled: invalidate,
    onError,
  });
  const remove = useMutation({
    mutationFn: (id: string) => gqlRequest(NoteDelete, { id }),
    onSettled: invalidate,
    onError,
  });
  return { create, update, remove };
}

const IssueReleasesQuery = graphql(
  `
    query IssueReleases($id: String!) {
      issue(id: $id) {
        id
        releases(first: 50) {
          nodes {
            ...ReleaseListFields
            pipeline {
              id
              slugId
              name
            }
          }
        }
      }
    }
  `,
  [ReleaseListFields],
);

export interface IssueRelease extends ReleaseListItem {
  pipeline: { id: string; slugId: string; name: string };
}

// The releases an issue is in (the issue page's Release property).
export function useIssueReleases(issueId: string | null) {
  return useQuery({
    queryKey: qk.issueReleases(issueId ?? ''),
    queryFn: async (): Promise<IssueRelease[]> => {
      const data = await gqlRequest(IssueReleasesQuery, { id: issueId! });
      return data.issue.releases.nodes.map((r) => ({
        ...toReleaseListItem(r),
        pipeline: { id: r.pipeline.id, slugId: r.pipeline.slugId, name: r.pipeline.name },
      }));
    },
    enabled: issueId != null,
  });
}

const TeamOpenReleasesQuery = graphql(
  `
    query TeamOpenReleases($filter: ReleaseFilter) {
      releases(filter: $filter, first: 250) {
        nodes {
          ...ReleaseListFields
          pipeline {
            id
            slugId
            name
          }
        }
      }
    }
  `,
  [ReleaseListFields],
);

// The planned and started releases of a team's pipelines (the issue's Release
// property offers them).
export function useTeamOpenReleases(teamId: string | null, enabled = true) {
  return useQuery({
    queryKey: qk.teamOpenReleases(teamId ?? ''),
    queryFn: async (): Promise<IssueRelease[]> => {
      const data = await gqlRequest(TeamOpenReleasesQuery, {
        filter: {
          pipeline: { teams: { some: { id: { eq: teamId } } } },
          stage: { type: { in: ['planned', 'started'] } },
        },
      });
      return data.releases.nodes.map((r) => ({
        ...toReleaseListItem(r),
        pipeline: { id: r.pipeline.id, slugId: r.pipeline.slugId, name: r.pipeline.name },
      }));
    },
    enabled: enabled && teamId != null,
  });
}
