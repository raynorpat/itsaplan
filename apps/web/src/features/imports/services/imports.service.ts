'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { instanceFetch } from '@/lib/auth-client';
import { graphql, gqlRequest } from '@/lib/graphql';
import { qk } from '@/services/queryKeys';
import { importIsRunning, type ImportDestination, type ImportView } from '../utils/imports';

// Issue imports. GitHub follows Linear's import model (issueImportCreateGithub,
// issueImportProcess); GitLab, Gitea and Forgejo, which Linear has no import for, and
// every read (the list, the people step, the GitHub connection and its repositories) go
// through /api/auth/instance/imports*. A pasted token is sent only in the request that
// uses it, through instanceFetch rather than a mutation hook, so it never sits in the
// query or mutation caches.

export interface ImportRepository {
  id: string;
  name: string;
}

export interface ImportPerson {
  key: string;
  login: string;
  name: string | null;
  email: string | null;
  issues: number;
  suggestion: string | null;
}

export interface ImportPeople {
  people: ImportPerson[];
  members: { id: string; name: string }[];
}

export interface GithubImportStatus {
  configured: boolean;
  appSlug: string | null;
  integration: { id: string; installationId: string; createdAt: string } | null;
}

export type TokenService = 'gitlab' | 'gitea' | 'forgejo';

// The auth client turns ISO date strings in its answers into Date objects; the page
// reads them as strings.
function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function normalize(imp: ImportView): ImportView {
  return { ...imp, createdAt: iso(imp.createdAt), updatedAt: iso(imp.updatedAt) };
}

// Polls every 2 s while an import fetches or creates records.
export function useImportsQuery(enabled: boolean) {
  return useQuery({
    queryKey: qk.imports,
    queryFn: async () =>
      (await instanceFetch<{ imports: ImportView[] }>('/instance/imports')).imports.map(normalize),
    enabled,
    refetchInterval: (query) => (query.state.data?.some(importIsRunning) ? 2000 : false),
  });
}

export function useImportPeopleQuery(id: string | null) {
  return useQuery({
    queryKey: qk.importPeople(id ?? ''),
    queryFn: () =>
      instanceFetch<ImportPeople>(`/instance/import/people?id=${encodeURIComponent(id!)}`),
    enabled: id != null,
  });
}

export function listTokenRepositories(
  service: TokenService,
  host: string,
  token: string,
): Promise<ImportRepository[]> {
  return instanceFetch<{ repositories: ImportRepository[] }>('/instance/imports/repositories', {
    method: 'POST',
    body: { service, host, token },
  }).then((r) => r.repositories);
}

export function startTokenImport(input: {
  service: TokenService;
  host: string;
  token: string;
  repository: string;
  destination: ImportDestination;
}): Promise<ImportView> {
  const { destination: d } = input;
  return instanceFetch<{ import: ImportView }>('/instance/imports/start', {
    method: 'POST',
    body: {
      service: input.service,
      host: input.host,
      token: input.token,
      repository: input.repository,
      teamId: d.teamId,
      teamName: d.teamName,
      includeClosed: d.includeClosed,
      labels: d.labels,
    },
  }).then((r) => normalize(r.import));
}

export function useGithubImportStatusQuery(enabled: boolean) {
  return useQuery({
    queryKey: qk.githubImport,
    queryFn: () => instanceFetch<GithubImportStatus>('/instance/imports/github'),
    enabled,
  });
}

export function useGithubRepositoriesQuery(enabled: boolean) {
  return useQuery({
    queryKey: qk.githubImportRepositories,
    queryFn: async () =>
      (
        await instanceFetch<{ repositories: { id: number; name: string }[] }>(
          '/instance/imports/github/repositories',
        )
      ).repositories,
    enabled,
  });
}

export function useDisconnectGithubImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      instanceFetch<{ success: boolean }>('/instance/imports/github/disconnect', {
        method: 'POST',
        body: {},
      }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.githubImport });
      qc.removeQueries({ queryKey: qk.githubImportRepositories });
    },
  });
}

const CreateGithubImport = graphql(`
  mutation CreateGithubImport(
    $githubRepoIds: [Int!]
    $githubLabels: [String!]
    $includeClosedIssues: Boolean
    $teamId: String
    $teamName: String
  ) {
    issueImportCreateGithub(
      githubRepoIds: $githubRepoIds
      githubLabels: $githubLabels
      includeClosedIssues: $includeClosedIssues
      teamId: $teamId
      teamName: $teamName
      instantProcess: false
    ) {
      success
      issueImport {
        id
      }
    }
  }
`);

// Errors are shown by the form, so this is a plain call rather than a mutation hook
// (whose failures the app also reports in a toast).
export async function startGithubImport(input: {
  repoIds: number[];
  destination: ImportDestination;
}): Promise<void> {
  await gqlRequest(CreateGithubImport, {
    githubRepoIds: input.repoIds,
    githubLabels: input.destination.labels,
    includeClosedIssues: input.destination.includeClosed,
    teamId: input.destination.teamId,
    teamName: input.destination.teamName,
  });
}

const ProcessGithubImport = graphql(`
  mutation ProcessGithubImport($issueImportId: String!, $mapping: JSONObject!) {
    issueImportProcess(issueImportId: $issueImportId, mapping: $mapping) {
      success
    }
  }
`);

// Starts creating records with the people matching: Linear's issueImportProcess for
// GitHub, the instance endpoint for the other sources.
export function useProcessImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      imp: ImportView;
      people: Record<string, string | null>;
      // CSV imports: status value → state id or name; values left out use the guess.
      statuses?: Record<string, string>;
    }) => {
      if (input.imp.service === 'github') {
        await gqlRequest(ProcessGithubImport, {
          issueImportId: input.imp.id,
          mapping: { people: input.people },
        });
        return;
      }
      await instanceFetch('/instance/imports/process', {
        method: 'POST',
        body: { id: input.imp.id, people: input.people, statuses: input.statuses },
      });
    },
    onSettled: (_data, _err, input) => {
      void qc.invalidateQueries({ queryKey: qk.imports });
      qc.removeQueries({ queryKey: qk.importPeople(input.imp.id) });
    },
  });
}

// Refreshes the list after a pasted-token import starts (it is not a mutation hook).
export function useRefreshImports() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: qk.imports });
}
